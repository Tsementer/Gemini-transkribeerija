// netlify/functions/transcribe-with-vertex.js - UUS FUNKTSIOON

// Google'i teek Vertex AI-ga suhtlemiseks
const { VertexAI } = require('@google-cloud/vertexai');

// See on vajalik autentimiseks ja projekti info saamiseks
const PROJECT_ID = process.env.GCLOUD_PROJECT;
const LOCATION = 'us-central1'; // Või mõni muu toetatud regioon

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    if (!PROJECT_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.error('❌ Server configuration error: Missing GCLOUD_PROJECT or credentials.');
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Server configuration error.' })
      };
    }

    const { fileUri, mimeType, language, maxSpeakers } = JSON.parse(event.body);

    if (!fileUri || !mimeType) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing fileUri or mimeType' })
      };
    }

    // Initsialiseerime Vertex AI kliendi
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    
    // Valime mudeli
    const model = 'gemini-1.5-flash-001'; 
    const generativeModel = vertexAI.getGenerativeModel({
      model: model,
    });
    
    // Loome audio osa päringu jaoks
    const audioPart = {
      file_data: {
        mime_type: mimeType,
        file_uri: fileUri
      }
    };
    
    // Loome prompti (juhised mudelile)
    let languageInstruction = (language && language !== 'auto') 
      ? `\n9. Transcribe in ${language} language.` 
      : '';
      
    let speakerInstruction = (maxSpeakers && maxSpeakers !== 'auto')
      ? `\n10. There are exactly ${maxSpeakers} speakers in this audio. Identify and label all ${maxSpeakers} speakers.`
      : '';
      
    const promptText = `You are an expert audio transcriptionist specializing in speaker diarization.

Your MOST IMPORTANT tasks are:
1. **Complete Transcription**: Transcribe the ENTIRE audio file from beginning to end.
2. **Speaker Accuracy**: Accurately identify and separate each unique speaker (Speaker 1, Speaker 2, etc.).
3. **Timestamps**: Provide accurate start and end times in H:MM:SS format.
4. **Output Format**: Output ONLY the JSON, nothing else.

Key Instructions:
- Transcribe the ENTIRE audio file.
- When you detect a voice change, assign a new speaker label.
- Break into logical segments based on pauses or speaker changes.
- Add correct punctuation.
- Keep speaker labels in English (Speaker 1, Speaker 2, etc.).${languageInstruction}${speakerInstruction}
- **CRITICAL**: Do not stop transcription early. Process the entire audio file.`;

    // Koostame päringu keha
    const request = {
      contents: [{
        role: 'user',
        parts: [{ text: promptText }, audioPart]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    // Saadame päringu Vertex AI-le
    const resp = await generativeModel.generateContent(request);
    const transcriptionResult = resp.response.candidates[0].content.parts[0].text;
    
    // Tagastame tulemuse brauserile
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: transcriptionResult // API tagastab juba JSON stringi
    };

  } catch (error) {
    console.error('💥 Vertex AI function error:', error.response ? error.response.data : error.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Error calling Vertex AI', details: error.message }),
    };
  }
};
