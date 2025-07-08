// netlify/functions/upload-proxy-background.js

const { Storage } = require('@google-cloud/storage');

// See funktsioon käivitub väljaspool handlerit, et vältida iga kord uue kliendi loomist
const storage = new Storage({
  // Oluline! Teenusekonto võti peab olema seadistatud Netlify keskkonnamuutujates.
  // Netlify tunneb automaatselt ära GOOGLE_APPLICATION_CREDENTIALS_JSON muutuja.
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
});

// See on bucket, kuhu Gemini API faile laeb. Tavaliselt on see kindla nimega.
// Kui see muutub, tuleb seda siin uuendada.
const BUCKET_NAME = 'carl_transkribeerija_failid_2025';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Kontrollime, et API võti oleks olemas
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }
  
  // Kontrollime, et teenusekonto andmed oleksid olemas
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Google service account credentials not configured'}) };
  }

  try {
    const { fileName, fileType } = JSON.parse(event.body);

    if (!fileName || !fileType) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileName or fileType in request body' }) };
    }

    // VÕTMEKOHT: Puhastame failinime, asendades kõik erimärgid allkriipsuga
    const sanitizedFileName = fileName
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')     // Eemalda erimärgid
      .replace(/_{2,}/g, '_')                // Asenda mitu allkriipsu ühega
      .replace(/^_+|_+$/g, '')               // Eemalda allkriipsud algusest/lõpust
      .substring(0, 50);                     // Piira pikkus 50 tähemärgiga

    // Genereerime unikaalse failinime, et vältida konflikte, KASUTADES PUHASTATUD NIME
    const uniqueFileName = `user-uploads/${new Date().getTime()}-${sanitizedFileName}`;
    
    // Loome viite failile Google'i bucketis
    const file = storage.bucket(BUCKET_NAME).file(uniqueFileName);

    // Genereerime "allkirjastatud URL-i". See on luba brauserile otse üles laadida.
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write', // Anname loa faili kirjutamiseks
      expires: Date.now() + 15 * 60 * 1000, // URL kehtib 15 minutit
      contentType: fileType, // Määrame ära, mis tüüpi faili tohib üles laadida
      method: 'PUT',
    });
    
    // See on URI, mille me hiljem saadame Gemini API-le transkribeerimiseks
    const fileUri = `gs://${BUCKET_NAME}/${uniqueFileName}`;

    // Saadame brauserile tagasi nii allkirjastatud URL-i kui ka faili URI
    return {
      statusCode: 200,
      body: JSON.stringify({
        signedUrl: signedUrl,
        fileUri: fileUri,
      }),
    };

  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal proxy error', details: error.message }),
    };
  }
};
