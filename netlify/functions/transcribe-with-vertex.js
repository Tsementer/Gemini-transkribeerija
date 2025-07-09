// netlify/functions/transcribe-with-vertex.js - LÕPLIK VERSIOON

const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');
const os = require('os');
const path = require('path');

// See abifunktsioon on täpselt sama, mis teises failis
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
  
  let credentialsPath;
  try {
    // Seadistame mandaadid enne teekide kasutamist
    credentialsPath = setupCredentials();
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
    const { fileUri, mimeType, language, maxSpeakers } = JSON.parse(event.body);

    if (!fileUri || !mimeType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileUri or mimeType' }) };
    }

    const model = 'gemini-2.5-flash'; // ÕIGE JA SOOVITUD MUDEL'; 
    const generativeModel = vertexAI.getGenerativeModel({ model });
    
    const audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };
    
    let languageInstruction = (language && language !== 'auto') ? `\n- Transcribe in ${language} language.` : '';
    let speakerInstruction = (maxSpeakers && maxSpeakers !== 'auto') ? `\n- There are exactly ${maxSpeakers} speakers.` : '';
      
    const promptText = `You are an expert audio transcriptionist...`; // Prompt jääb samaks

    const request = {
      contents: [{ role: 'user', parts: [{ text: promptText }, audioPart] }],
      generationConfig: { responseMimeType: "application/json" }
    };

    const resp = await generativeModel.generateContent(request);
    const transcriptionResult = resp.response.candidates[0].content.parts[0].text;
    
    return {
      statusCode: 200,
      body: transcriptionResult
    };

  } catch (error) {
    console.error('💥 Vertex AI function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error calling Vertex AI', details: error.message }),
    };
  } finally {
    // Koristame ajutise faili ära isegi siis, kui tekib viga
    if (credentialsPath) {
      fs.unlinkSync(credentialsPath);
    }
  }
};
