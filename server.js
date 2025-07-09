const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { VertexAI } = require('@google-cloud/vertexai');
const cors = require('cors');

const app = express();
app.use(cors());
// Suurendame päringu keha limiiti, et mahutada ka suuri transkriptsioone
app.use(express.json({ limit: '10mb' }));

// --- ABIFUNKTSIOONID (KÕNELEJATE ÜHENDAMINE JA TEKSTI PUHASTAMINE) ---

function parseTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

function mergeSpeakerSegments(transcriptionData, mergeThreshold = 3) {
    if (!transcriptionData.segments || transcriptionData.segments.length === 0 || mergeThreshold <= 0) {
        return transcriptionData;
    }
    
    const mergedSegments = [];
    let currentSegment = { ...transcriptionData.segments[0] };
    
    for (let i = 1; i < transcriptionData.segments.length; i++) {
        const segment = transcriptionData.segments[i];
        const prevEnd = parseTime(currentSegment.end);
        const currStart = parseTime(segment.start);
        
        if (segment.speaker === currentSegment.speaker && (currStart - prevEnd) < mergeThreshold) {
            currentSegment.text += ' ' + segment.text;
            currentSegment.end = segment.end;
        } else {
            mergedSegments.push(currentSegment);
            currentSegment = { ...segment };
        }
    }
    mergedSegments.push(currentSegment);
    
    return { ...transcriptionData, segments: mergedSegments };
}

async function cleanTranscription(transcriptionData, cleaningLevel, language) {
    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const cleaningLevels = {
        light: "Minimal edits: Remove only 'uh', 'um', 'ee'. Fix severe stutters.",
        moderate: "Moderate cleaning: Remove all filler words, repetitions, and false starts. Correct basic grammar.",
        aggressive: "Aggressive editing: Rewrite sentences for natural flow. Combine related thoughts. Make it smooth and pleasant to read, but preserve the core ideas.",
        editorial: "Publication-ready prose: Transform speech into a polished article. Restructure passages for clarity and impact. Elevate the language significantly."
    };

    const prompt = `You are a transcription editor. Your task is to clean and refine the following JSON transcription data.
- Language: ${language}
- Cleaning Level: ${cleaningLevel}. Instruction: "${cleaningLevels[cleaningLevel]}"
- UNIVERSAL RULES:
  - NEVER change the meaning or intent.
  - Keep all speaker labels (Speaker 1, etc.) and timestamps EXACTLY as they are.
  - Maintain the exact same JSON structure.
  - For unclear audio, use *[unclear]* notation.
- Return ONLY the cleaned JSON object.

Input transcription:
${JSON.stringify(transcriptionData, null, 2)}`;

    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
    };
    
    const resp = await model.generateContent(request);
    let cleanedText = resp.response.candidates[0].content.parts[0].text;
    cleanedText = cleanedText.replace(/```json\n/g, '').replace(/\n```/g, '');

    return JSON.parse(cleanedText);
}


// --- API LÕPP-PUNKTID ---

// URL-i genereerimine (jääb samaks)
app.post('/generate-upload-url', async (req, res) => {
    try {
        const storage = new Storage();
        const { fileName, fileType } = req.body;
        // ... (see kood jääb täpselt samaks, mis varem)
        const BUCKET_NAME = 'carl_transkribeerija_failid_2025';
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_').substring(0, 100);
        const uniqueFileName = `user-uploads/${new Date().getTime()}-${sanitizedFileName}`;
        const file = storage.bucket(BUCKET_NAME).file(uniqueFileName);
        const [signedUrl] = await file.getSignedUrl({
            version: 'v4', action: 'write', expires: Date.now() + 15 * 60 * 1000,
            contentType: fileType, method: 'PUT',
        });
        const fileUri = `gs://${BUCKET_NAME}/${uniqueFileName}`;
        res.status(200).json({ signedUrl, fileUri });
    } catch (error) {
        console.error('💥 URL Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate upload URL', details: error.message });
    }
});

// Transkribeerimine (uuendatud)
app.post('/transcribe-with-vertex', async (req, res) => {
    try {
        const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
        const { fileUri, mimeType, language, maxSpeakers, shouldClean, cleaningLevel, mergeThreshold } = req.body;

        const generativeModel = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };
        
        const promptText = `Your task is to transcribe the entire audio file, accurately identify each speaker (Speaker 1, Speaker 2, etc.), and provide timestamps in H:MM:SS format. Output ONLY a valid JSON object with a "segments" array and a "summary" object containing "total_speakers", "duration", and "language". The language should be the BCP-47 code. Language to transcribe in: ${language}. Max speakers to identify: ${maxSpeakers === 'auto' ? 'auto-detect' : maxSpeakers}.`;

        const request = {
            contents: [{ role: 'user', parts: [{ text: promptText }, audioPart] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const resp = await generativeModel.generateContent(request);
        let responseText = resp.response.candidates[0].content.parts[0].text;
        responseText = responseText.replace(/```json\n/g, '').replace(/\n```/g, '');
        let transcriptionResult = JSON.parse(responseText);

        // Töötle tulemusi vastavalt kasutaja valikutele
        if (shouldClean) {
            transcriptionResult = await cleanTranscription(transcriptionResult, cleaningLevel, language);
        }
        if (mergeThreshold > 0) {
            transcriptionResult = mergeSpeakerSegments(transcriptionResult, mergeThreshold);
        }

        res.status(200).json(transcriptionResult);

    } catch (error) {
        console.error('💥 Transcription Error:', error);
        res.status(500).json({ error: 'Error during transcription process', details: error.message });
    }
});

// UUS: Tulemuste ümbertöötlemine
app.post('/reprocess-transcription', async (req, res) => {
    try {
        let { transcriptionData, shouldClean, cleaningLevel, mergeThreshold, language } = req.body;

        if (!transcriptionData) {
            return res.status(400).json({ error: 'Missing transcription data' });
        }

        if (shouldClean) {
            transcriptionData = await cleanTranscription(transcriptionData, cleaningLevel, language);
        }
        if (mergeThreshold > 0) {
            transcriptionData = mergeSpeakerSegments(transcriptionData, mergeThreshold);
        }
        
        res.status(200).json(transcriptionData);

    } catch (error)
    {
        console.error('💥 Reprocessing Error:', error);
        res.status(500).json({ error: 'Failed to reprocess results', details: error.message });
    }
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
