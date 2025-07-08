// netlify/functions/upload-proxy.js

const fetch = require('node-fetch');

exports.handler = async function (event) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key is not configured on the server.' }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }
  
  const fileSize = event.headers['x-goog-upload-header-content-length'];
  const fileType = event.headers['x-goog-upload-header-content-type'];
  
  if (!fileSize || !fileType) {
    return {
        statusCode: 400,
        body: 'Missing file metadata headers.'
    }
  }

  const UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}&uploadType=resumable`;

  try {
    const initResponse = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileSize,
        'X-Goog-Upload-Header-Content-Type': fileType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        displayName: 'user-uploaded-file'
      })
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error('Google API init error:', errorText);
      return {
        statusCode: initResponse.status,
        body: JSON.stringify({ error: 'Failed to initialize upload with Google.', details: errorText }),
      };
    }

    const sessionUri = initResponse.headers.get('X-Goog-Upload-URL');

    const uploadResponse = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
            'Content-Type': fileType
        },
        body: Buffer.from(event.body, 'base64')
    });

    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Google API upload error:', errorText);
        return {
          statusCode: uploadResponse.status,
          body: JSON.stringify({ error: 'Failed to upload file to Google.', details: errorText }),
        };
    }

    const finalData = await uploadResponse.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(finalData),
    };

  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An internal error occurred in the proxy.' }),
    };
  }
};
