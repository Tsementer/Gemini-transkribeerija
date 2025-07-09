const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
app.use(express.json());

// --- Autentimine on nüüd automaatne! ---
// Kui kood jookseb Cloud Run'is, kasutavad need teegid
// automaatselt teenusele määratud teenusekonto õigusi.
// Me ei pea enam mandaatidega tegelema.
const storage = new Storage();
const vertexAI = new VertexAI({ 
    project: process.env.GCLOUD_PROJECT, 
    location: 'europe-north1' 
});

// --- URL-i genereerimise loogika ---
app.post('/generate-upload-url', async (req, res) => {
    try {
        const { fileName, fileType } = req.body;
        if (!fileName || !fileType) {
            return res.status(400).json({ error: 'Missing fileName or fileType' });
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

        res.status(200).json({ signedUrl, fileUri });

    } catch (error) {
        console.error('💥 URL Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate upload URL', details: error.message });
    }
});

// --- Transkribeerimise loogika ---
app.post('/transcribe-with-vertex', async (req, res) => {
    try {
        const { fileUri, mimeType, language, maxSpeakers } = req.body;
        if (!fileUri || !mimeType) {
            return res.status(400).json({ error: 'Missing fileUri or mimeType' });
        }

        const model = 'gemini-2.5-flash'; 
        const generativeModel = vertexAI.getGenerativeModel({ model });
        
        const audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };
        
        let languageInstruction = (language && language !== 'auto') ? `\n- Transcribe in ${language} language.` : '';
        let speakerInstruction = (maxSpeakers && maxSpeakers !== 'auto') ? `\n- There are exactly ${maxSpeakers} speakers.` : '';
          
        const promptText = `You are an expert audio transcriptionist. Your most important task is to transcribe the entire audio file, accurately identify each speaker, and provide timestamps in H:MM:SS format. Output ONLY a valid JSON object with a "segments" array.${languageInstruction}${speakerInstruction}`;

        const request = {
            contents: [{ role: 'user', parts: [{ text: promptText }, audioPart] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const resp = await generativeModel.generateContent(request);
        const transcriptionResult = resp.response.candidates[0].content.parts[0].text;
        
        // Saadame tulemuse otse tagasi
        res.status(200).send(transcriptionResult);

    } catch (error) {
        console.error('💥 Transcription Error:', error);
        res.status(500).json({ error: 'Error calling Vertex AI', details: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
