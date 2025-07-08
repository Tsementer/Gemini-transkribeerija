// netlify/functions/upload-proxy-background.js

const fetch = require('node-fetch');

exports.handler = async function (event) {
  // Kontrollime, et tegemist on õige päringuga
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    // Parsime brauserist saadetud JSON-i
    const { fileSize, fileType, fileData } = JSON.parse(event.body);

    if (!fileSize || !fileType || !fileData) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing file metadata or data in request body' }) };
    }

    const UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}&uploadType=resumable`;

    // 1. Alustame resumable upload sessiooni Google'iga
    const initResponse = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
        'X-Goog-Upload-Header-Content-Type': fileType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { displayName: 'user-upload.m4a' } })
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      return { statusCode: initResponse.status, body: JSON.stringify({ error: 'Google API init error', details: errorText }) };
    }

    // 2. Saame Google'ilt URL'i, kuhu fail laadida
    const sessionUri = initResponse.headers.get('X-Goog-Upload-URL');

    // 3. Laeme faili sisu sinna URL'ile
    const uploadResponse = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Type': fileType },
      body: Buffer.from(fileData, 'base64') // Dekodeerime base64 stringi
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      return { statusCode: uploadResponse.status, body: JSON.stringify({ error: 'Google API upload error', details: errorText }) };
    }

    // 4. Saadame eduka vastuse tagasi brauserile
    const googleResponse = await uploadResponse.json();
    return { statusCode: 200, body: JSON.stringify(googleResponse) };

  } catch (error) {
    console.error('Proxy error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal proxy error', details: error.message }) };
  }
};
