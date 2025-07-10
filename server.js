const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { VertexAI } = require('@google-cloud/vertexai');
const cors = require('cors');

const app = express();
app.use(cors());
// Suurendame limiiti, et mahutada ka suuri transkriptsioone ümbertöötlemisel
app.use(express.json({ limit: '10mb' }));

// --- 1. ETAPP: INTELLIGENTNE ESIMENE TRANSKRIPTSIOON ---
async function intelligentTranscription(fileUri, mimeType, language, maxSpeakers) {
    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };

    const prompt = `
You are a highly precise audio transcription and diarization engine. Your task is to process an audio file and return a structured JSON object.

### Core Task:
1.  **Transcribe Accurately:** Transcribe the entire audio file from start to finish.
2.  **Identify Speakers:** Identify each unique speaker and label them sequentially (Speaker 1, Speaker 2, etc.). Use '${maxSpeakers === 'auto' ? 'auto-detection' : `a maximum of ${maxSpeakers}`}' for speaker count.
3.  **Provide Timestamps:** Assign accurate start and end timestamps in H:MM:SS format for every segment.
4.  **Detect Language:** Identify the primary language of the conversation.
5.  **Calculate Duration:** Determine the total duration of the audio.

### Output Specification:
- You MUST return ONLY a valid JSON object. Do not include any text or markdown before or after the JSON.
- The JSON object must have a 'segments' array and a 'summary' object.
- The 'summary' object must contain 'total_speakers' (number), 'duration' (string, e.g., "15:32"), and 'language' (string, BCP-47 code, e.g., "et-EE").

### Language for Transcription:
- The user has requested transcription in: **${language === 'auto' ? 'auto-detect the language' : language}**.

Process the audio and provide the structured JSON output.`;

    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }, audioPart] }],
        generationConfig: { responseMimeType: "application/json" }
    };

    const resp = await model.generateContent(request);
    let responseText = resp.response.candidates[0].content.parts[0].text;
    responseText = responseText.replace(/```json\n/g, '').replace(/\n```/g, '');
    return JSON.parse(responseText);
}

// --- 2. ETAPP: TÄIUSTATUD PUHASTAMINE JA ÜMBERTÖÖTLEMINE (UUENDATUD) ---
async function advancedCleaningAndReprocessing(transcriptionData, { shouldClean, cleaningLevel, mergeThreshold, language }) {
    let processedData = JSON.parse(JSON.stringify(transcriptionData));

    // A. Segmentide ühendamine (toimub alati enne puhastamist)
    if (mergeThreshold > 0) {
        if (processedData.segments && processedData.segments.length > 0) {
            const mergedSegments = [];
            let currentSegment = { ...processedData.segments[0] };
            for (let i = 1; i < processedData.segments.length; i++) {
                const segment = processedData.segments[i];
                const parseTime = (str) => str ? str.split(':').reverse().reduce((acc, val, i) => acc + parseInt(val) * Math.pow(60, i), 0) : 0;
                if (segment.speaker === currentSegment.speaker && (parseTime(segment.start) - parseTime(currentSegment.end)) < mergeThreshold) {
                    currentSegment.text += ' ' + segment.text;
                    currentSegment.end = segment.end;
                } else {
                    mergedSegments.push(currentSegment);
                    currentSegment = { ...segment };
                }
            }
            mergedSegments.push(currentSegment);
            processedData.segments = mergedSegments;
        }
    }

    // B. Teksti puhastamine (kui kasutaja seda soovis)
    if (shouldClean) {
        const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
        const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        let languageSpecificRules = '';
        if (language === 'et') {
            languageSpecificRules = `### Estonian-Specific Rules:\n- **Fillers:** Aggressively remove: "nii-öelda", "eks ole", "ütleme", "noh", "ee", "ää", "mm".`;
        }
        
        // Uuendatud ja rangemad juhised "Toimetaja" tasemele
        const cleaningLevels = {
            light: `**Level: Light.** Actions: Remove only obvious audible fillers (uh, um, ee). Do not rephrase.`,
            moderate: `**Level: Moderate.** Actions: Remove all filler words. Fix repetitions and false starts. Correct basic grammar.`,
            aggressive: `**Level: Aggressive.** Actions: Remove all redundancies. Restructure sentences for natural flow. Fix all grammar.`,
            editorial: `**Level: Editor.** Goal: Produce publication-ready prose.
- **CRITICAL ACTION:** You MUST completely eliminate short, non-substantive interjections (like "Mhm", "Jah", "Just", "Okay", "Aha", etc.) by replacing their text content with an empty string (""). This is the most important rule.
- **ACTIONS:** Rephrase sentences and restructure entire passages for maximum clarity and impact. Elevate the language and vocabulary to be suitable for a published article.`
        };

        const cleaningPrompt = `You are a professional transcription editor. Your task is to refine the provided JSON data.

1.  **Adhere to the Cleaning Level:**
    ${cleaningLevels[cleaningLevel]}

2.  **Apply Language-Specific Rules:**
    ${languageSpecificRules || 'Apply general best practices for the detected language.'}

3.  **Mandatory Universal Rules:**
    - **Preserve Meaning:** Do not change the core meaning or any factual information.
    - **Maintain Structure:** The output MUST be only the JSON object, identical in structure to the input.
    - **Keep Timestamps & Speakers:** Speaker labels and their timestamps ("start", "end") must remain completely untouched.

### Input Data:
${JSON.stringify(processedData, null, 2)}

### Output (JSON only):`;

        const request = {
            contents: [{ role: 'user', parts: [{ text: cleaningPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const resp = await model.generateContent(request);
        let cleanedText = resp.response.candidates[0].content.parts[0].text;
        cleanedText = cleanedText.replace(/```json\n/g, '').replace(/\n```/g, '');
        processedData = JSON.parse(cleanedText);

        // UUS SAMM: Eemalda programmselt kõik segmendid, mille AI tühjaks tegi
        if (cleaningLevel === 'editorial' && processedData.segments) {
            processedData.segments = processedData.segments.filter(segment => segment.text && segment.text.trim() !== '');
        }
    }

    return processedData;
}


// --- API LÕPP-PUNKTID ---

// URL-i genereerimine (jääb samaks)
app.post('/generate-upload-url', async (req, res) => {
    try {
        const storage = new Storage();
        const { fileName, fileType } = req.body;
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

// Transkribeerimise põhiprotsess
app.post('/transcribe-with-vertex', async (req, res) => {
    try {
        const { fileUri, mimeType, language, maxSpeakers, ...processingOptions } = req.body;

        // 1. ETAPP: Intelligentne esmane transkriptsioon
        const rawTranscription = await intelligentTranscription(fileUri, mimeType, language, maxSpeakers);

        // 2. ETAPP: Täiustatud puhastamine ja ümbertöötlemine
        const finalResult = await advancedCleaningAndReprocessing(rawTranscription, processingOptions);

        res.status(200).json(finalResult);

    } catch (error) {
        console.error('💥 Transcription Error:', error);
        res.status(500).json({ error: 'Error during transcription process', details: error.message });
    }
});

// Tulemuste ümbertöötlemine
app.post('/reprocess-transcription', async (req, res) => {
    try {
        const { transcriptionData, ...processingOptions } = req.body;
        if (!transcriptionData) {
            return res.status(400).json({ error: 'Missing transcription data' });
        }
        
        const finalResult = await advancedCleaningAndReprocessing(transcriptionData, processingOptions);
        res.status(200).json(finalResult);

    } catch (error) {
        console.error('💥 Reprocessing Error:', error);
        res.status(500).json({ error: 'Failed to reprocess results', details: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
