// netlify/functions/generate-upload-url.js - VERSIOON, MIS LAEB MANDAADID OTSE

const { Storage } = require('@google-cloud/storage');

// Proovime mandaadid otse sisse lugeda
let storage;
try {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    storage = new Storage({ credentials });
} catch (e) {
    console.error("💥 Failed to parse or use credentials from env var:", e);
    // Jätame storage tühjaks, et handler saaks vea tagastada
}


exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Kui mandaatide lugemine ebaõnnestus juba alguses
  if (!storage) {
      return { 
          statusCode: 500, 
          body: JSON.stringify({ error: 'Server configuration error: Could not initialize credentials.' })
      };
  }

  try {
    const { fileName, fileType } = JSON.parse(event.body);

    if (!fileName || !fileType) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileName or fileType' }) };
    }

    const BUCKET_NAME = 'carl_transkribeerija_failid_2025';
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_').substring(0, 100);
    const uniqueFileName = `user-uploads/${new Date().getTime()}-${sanitizedFileName}`;
    const file = storage.bucket(BUCKET_NAME).file(uniqueFileName);

    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: fileType,
      method: 'PUT',
    });
    
    const fileUri = `gs://${BUCKET_NAME}/${uniqueFileName}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ signedUrl, fileUri }),
    };

  } catch (error) {
    console.error('💥 Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message }),
    };
  }
};
