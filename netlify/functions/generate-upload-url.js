// netlify/functions/generate-upload-url.js - LÕPLIK VERSIOON

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const os = require('os');
const path = require('path');

// See abifunktsioon kirjutab mandaadid ajutisse faili ja tagastab faili asukoha
const setupCredentials = () => {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable not set.');
  }
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, 'creds.json');
  fs.writeFileSync(filePath, credsJson);
  return filePath;
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Seadistame mandaadid enne teekide kasutamist
    const credentialsPath = setupCredentials();
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

    const storage = new Storage();
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
    
    // Koristame ajutise faili ära
    fs.unlinkSync(credentialsPath);

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
