// netlify/functions/generate-upload-url.js - UUENDATUD VERSIOON VERTEX AI JAOKS

const { Storage } = require('@google-cloud/storage');

// See funktsioon käivitub väljaspool handlerit.
// @google-cloud/storage teek kasutab automaatselt GOOGLE_APPLICATION_CREDENTIALS_JSON
// keskkonnamuutujat, kui see on olemas. Seega pole vaja mandaate käsitsi määrata.
const storage = new Storage();

// See on bucket, kuhu faile laetakse.
const BUCKET_NAME = 'carl_transkribeerija_failid_2025';

exports.handler = async function (event) {
  // Lubame päringuid ainult POST meetodiga
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Kontrollime, et teenusekonto andmed oleksid Netlify's olemas
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        console.error('❌ Google service account credentials not configured in Netlify.');
        return { 
          statusCode: 500, 
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Server configuration error: Missing credentials.' })
        };
    }

    const { fileName, fileType } = JSON.parse(event.body);

    if (!fileName || !fileType) {
        return { 
          statusCode: 400, 
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Missing fileName or fileType in request body' }) 
        };
    }

    // Puhastame failinime, et vältida probleeme erimärkidega
    const sanitizedFileName = fileName
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 100); // Piirame pikkust

    const uniqueFileName = `user-uploads/${new Date().getTime()}-${sanitizedFileName}`;
    
    const file = storage.bucket(BUCKET_NAME).file(uniqueFileName);

    // Genereerime allkirjastatud URL-i, mis lubab brauseril otse faili üles laadida
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // Kehtib 15 minutit
      contentType: fileType,
      method: 'PUT',
    });
    
    // See on URI, mille me saadame Gemini API-le
    const fileUri = `gs://${BUCKET_NAME}/${uniqueFileName}`;

    // Saadame brauserile tagasi nii allkirjastatud URL-i kui ka faili URI
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        signedUrl: signedUrl,
        fileUri: fileUri,
      }),
    };

  } catch (error) {
    console.error('💥 Function error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message }),
    };
  }
};
