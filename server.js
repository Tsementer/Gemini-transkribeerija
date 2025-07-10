const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { VertexAI } = require('@google-cloud/vertexai');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- ABIFUNKTSIOONID ---

// 1. ETAPP: INTELLIGENTNE ESIMENE TRANSKRIPTSIOON
async function intelligentTranscription(fileUri, mimeType, language, maxSpeakers) {
    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };

    const prompt = `
You are a highly precise audio transcription and diarization system. Your task is to process an audio file and return a structured JSON object.

### Core Task:
1.  **Accurate Transcription:** Transcribe the spoken content with high accuracy.
2.  **Speaker Identification:** Identify each unique speaker and label them sequentially (Speaker 1, Speaker 2, etc.).
3.  **Precise Timestamps:** Assign accurate start and end timestamps in H:MM:SS format for every segment. The end time of the last segment should correspond to the end of speech in the audio.
4.  **Detect Language:** Identify the primary language of the conversation.

### Output Specification:
- You MUST return ONLY a valid JSON object.
- The JSON object must have a 'segments' array and a 'summary' object.
- The 'summary' object must contain 'total_speakers' (number) and 'language' (string, BCP-47 code, e.g., "et-EE").

### Language for Transcription:
- The user has requested transcription in: ${language === 'auto' ? 'auto-detect the language' : language}.
`;

    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }, audioPart] }],
        generationConfig: { responseMimeType: "application/json" }
    };

    const resp = await model.generateContent(request);
    let responseText = resp.response.candidates[0].content.parts[0].text;
    responseText = responseText.replace(/```json\n/g, '').replace(/\n```/g, '');
    return JSON.parse(responseText);
}

// 2. ETAPP: KÕNELEJATE NIMEDE TUVASTAMINE (UUS!)
async function identifySpeakerNames(transcriptionData) {
    if (!transcriptionData.segments || transcriptionData.segments.length < 2) {
        return {}; // Ei saa nimesid tuvastada, kui juttu on liiga vähe
    }
    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    // Võtame esimesed 5 minutit transkriptsioonist analüüsiks
    const initialTranscript = transcriptionData.segments.slice(0, 30).map(s => `${s.speaker}: ${s.text}`).join('\n');

    const prompt = `
You are a context analysis expert. Based on the following initial conversation transcript, identify the names of the speakers.
The speakers are currently labeled as "Speaker 1", "Speaker 2", etc.
Analyze the introductions, how they address each other, or any other context clues.

Return ONLY a valid JSON object mapping the label to the identified name, like this:
{
  "Speaker 1": "Firstname Lastname",
  "Speaker 2": "Firstname Lastname"
}
If a name cannot be identified for a speaker, use the original label (e.g., "Speaker 1").

Transcript snippet:
---
${initialTranscript}
---

Output (JSON only):`;

    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
    };
    const resp = await model.generateContent(request);
    let responseText = resp.response.candidates[0].content.parts[0].text;
    responseText = responseText.replace(/```json\n/g, '').replace(/\n```/g, '');
    return JSON.parse(responseText);
}

// 3. ETAPP: AGRESSIIVNE TOIMETAMINE (TÄIESTI UUS PROMPT!)
async function editorialRewrite(transcriptionData, speakerNameMap) {
    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-north1' });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Asendame "Speaker X" nimedega enne saatmist
    const transcriptWithNames = transcriptionData.segments.map(s => {
        const name = speakerNameMap[s.speaker] || s.speaker;
        return `${name}: ${s.text}`;
    }).join('\n');

    const prompt = `
You are a professional editor for a prestigious publication. Your task is to transform a raw, conversational transcript into a clean, flowing, and highly readable article.

### CRITICAL INSTRUCTIONS:
1.  **Eliminate All Non-Content:** You MUST completely remove all conversational filler, short interjections, and non-substantive replies. This includes, but is not limited to: "Mhm", "Jah", "Just", "Eks ole", "Noh", "Okay", "Aha", etc.
2.  **Merge and Rephrase for Flow:** Do not just delete words. Actively combine short, choppy sentences into longer, more coherent paragraphs. Rephrase conversational language into professional, written language. Change sentence structure and word order to improve readability.
3.  **Create a Narrative:** The final output should feel like a well-written interview or article, not a line-by-line transcript. Group related ideas together, even if they were spoken a few lines apart.
4.  **Attribute Correctly:** Ensure the final text is correctly attributed to the speakers using their real names.

### Raw Transcript Input (with speaker names):
---
${transcriptWithNames}
---

### Desired Output:
Return a SINGLE string of text representing the final, polished article. The text should be formatted with paragraphs. Do NOT return JSON. Example:

Kristjan Kuhi: "Meie jaoks on suur küsimärk, mis toimub Lätis. Teoreetiliselt on 49% Balti reservvõimsustest Lätis, aga nad ei osale turul. Nii meile kui ka teistele turuosalistele on ebaselge, miks need võimsused ei osale ja kaua see kestab."

Carl-Robert Puhm: "Olen ka ise Latvenergole küsimusi saatnud, aga vastust pole saanud. Miks nad selgeid vastuseid ei anna? Loogiliselt peaks ju olema kindel põhjus."
...and so on.

### Final Article (string only):`;

    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
        // Ei kasuta JSON-väljundit, ootame puhast teksti
    };
    const resp = await model.generateContent(request);
    // Tagastame otse mudeli genereeritud teksti
    return resp.response.candidates[0].content.parts[0].text;
}

// TÄIUSTATUD PUHASTAMINE JA ÜMBERTÖÖTLEMINE (olemasoleva funktsionaalsuse jaoks)
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
        
        const cleaningLevels = {
            light: `**Level: Light.** Actions: Remove only obvious audible fillers (uh, um, ee). Do not rephrase.`,
            moderate: `**Level: Moderate.** Actions: Remove all filler words. Fix repetitions and false starts. Correct basic grammar.`,
            aggressive: `**Level: Aggressive.** Actions: Create clean, readable text. Actions: Remove all redundancies. Restructure sentences for natural flow. Fix all grammar.`
        };

        const cleaningPrompt = `You are a professional transcription editor. Your task is to refine the provided JSON data.\n\n1.  **Adhere to the Cleaning Level:**\n    ${cleaningLevels[cleaningLevel]}\n\n2.  **Apply Language-Specific Rules:**\n    ${languageSpecificRules || 'Apply general best practices for the detected language.'}\n\n3.  **Mandatory Universal Rules:**\n    - **Preserve Meaning:** Do not change the core meaning.\n    - **Maintain Structure:** The output MUST be only the JSON object, identical in structure to the input.\n    - **Keep Timestamps & Speakers:** Speaker labels and their timestamps ("start", "end") must remain completely untouched.\n\n### Input Data:\n${JSON.stringify(processedData, null, 2)}\n\n### Output (JSON only):`;

        const request = {
            contents: [{ role: 'user', parts: [{ text: cleaningPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const resp = await model.generateContent(request);
        let cleanedText = resp.response.candidates[0].content.parts[0].text;
        cleanedText = cleanedText.replace(/```json\n/g, '').replace(/\n```/g, '');
        processedData = JSON.parse(cleanedText);
    }

    return processedData;
}


// --- API LÕPP-PUNKTID ---

// URL-i genereerimine
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

// Transkribeerimise põhiprotsess (UUENDATUD KOLMEETAPILISE ARHITEKTUURIGA)
app.post('/transcribe-with-vertex', async (req, res) => {
    try {
        const { fileUri, mimeType, language, maxSpeakers, shouldClean, cleaningLevel, ...processingOptions } = req.body;

        // 1. ETAPP: Intelligentne esmane transkriptsioon
        const rawTranscription = await intelligentTranscription(fileUri, mimeType, language, maxSpeakers);

        // KESTUSE ARVUTAMINE SERVERIS
        if (rawTranscription.segments && rawTranscription.segments.length > 0) {
            const lastSegment = rawTranscription.segments[rawTranscription.segments.length - 1];
            rawTranscription.summary.duration = lastSegment.end || '0:00:00';
        } else {
            rawTranscription.summary.duration = '0:00:00';
        }

        // Kui kasutaja ei soovi puhastamist, tagastame toore tulemuse koos kestusega
        if (!shouldClean) {
            return res.status(200).json(rawTranscription);
        }

        // Kui puhastamise tase on "Toimetaja", käivitame uue, agressiivse protsessi
        if (cleaningLevel === 'editorial') {
            // 2. ETAPP: Tuvastame nimed
            const speakerNames = await identifySpeakerNames(rawTranscription);
            
            // 3. ETAPP: Kirjutame teksti ümber
            const rewrittenText = await editorialRewrite(rawTranscription, speakerNames);
            
            // Tagastame spetsiaalse formaadi, mida esiserv oskab kuvada
            return res.status(200).json({
                isEditorial: true,
                content: rewrittenText,
                summary: rawTranscription.summary // Lisame summary ka toimetatud versiooni juurde
            });
        }
        
        // Teiste puhastustasemete jaoks kasutame olemaslevat loogikat
        const finalResult = await advancedCleaningAndReprocessing(rawTranscription, { 
            shouldClean, 
            cleaningLevel, 
            language,
            ...processingOptions 
        });

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
        
        // Kui toimetaja tase, siis kasutame kolmeetapilist protsessi
        if (processingOptions.cleaningLevel === 'editorial' && processingOptions.shouldClean) {
            const speakerNames = await identifySpeakerNames(transcriptionData);
            const rewrittenText = await editorialRewrite(transcriptionData, speakerNames);
            
            return res.status(200).json({
                isEditorial: true,
                content: rewrittenText,
                summary: transcriptionData.summary
            });
        }
        
        // Muudel juhtudel kasutame tavalist puhastamist
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
