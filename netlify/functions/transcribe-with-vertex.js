// netlify/functions/transcribe-with-vertex.js - VERSIOON, MIS LAEB MANDAADID OTSE

const { VertexAI } = require('@google-cloud/vertexai');

// Proovime mandaadid otse sisse lugeda
let vertexAI;
try {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    vertexAI = new VertexAI({ 
        project: process.env.GCLOUD_PROJECT, 
        location: 'europe-north1',
        credentials
    });
} catch(e) {
    console.error("💥 Failed to parse or use credentials from env var:", e);
    // Jätame vertexAI tühjaks, et handler saaks vea tagastada
}


exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  // Kui mandaatide lugemine ebaõnnestus juba alguses
  if (!vertexAI) {
      return { 
          statusCode: 500, 
          body: JSON.stringify({ error: 'Server configuration error: Could not initialize credentials or project ID.' })
      };
  }

  try {
    const { fileUri, mimeType, language, maxSpeakers } = JSON.parse(event.body);

    if (!fileUri || !mimeType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileUri or mimeType' }) };
    }

    const model = 'gemini-1.5-flash-001'; 
    const generativeModel = vertexAI.getGenerativeModel({ model });
    
    const audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };
    
    let languageInstruction = (language && language !== 'auto') ? `\n- Transcribe in ${language} language.` : '';
    let speakerInstruction = (maxSpeakers && maxSpeakers !== 'auto') ? `\n- There are exactly ${maxSpeakers} speakers.` : '';
      
    const promptText = `You are an expert audio transcriptionist. Your task is to transcribe the entire audio file, identify each speaker, and provide timestamps in H:MM:SS format. Output ONLY a valid JSON object with a "segments" array.${languageInstruction}${speakerInstruction}`;

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
  }
};
