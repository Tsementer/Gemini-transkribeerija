// netlify/functions/upload-to-gemini.js - MINIMAALNE TEST VERSIOON
exports.handler = async function (event) {
  console.log('🚀 FUNCTION STARTED!');
  console.log('Method:', event.httpMethod);
  console.log('Body size:', event.body?.length || 0, 'bytes');
  
  // Kontrolli method
  if (event.httpMethod !== 'POST') {
    console.log('❌ Wrong method');
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Kontrolli API key
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('API Key exists:', !!apiKey);
  console.log('API Key length:', apiKey?.length || 0);
  
  if (!apiKey) {
    console.log('❌ No API key');
    return { 
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) 
    };
  }

  // Kontrolli body suurus
  if (!event.body) {
    console.log('❌ No body');
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'No request body' }),
    };
  }

  // Kontrolli body suurust ENNE JSON parsimist
  const bodySize = event.body.length;
  console.log('📦 Body size:', bodySize, 'bytes');
  console.log('📦 Body size:', Math.round(bodySize / 1024 / 1024), 'MB');
  
  // Netlify limit on 6MB
  if (bodySize > 6 * 1024 * 1024) {
    console.log('❌ Body too large for Netlify');
    return {
      statusCode: 413,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: 'Request too large for Netlify Functions (>6MB)',
        actualSize: Math.round(bodySize / 1024 / 1024) + 'MB',
        suggestion: 'Use smaller file or Google Cloud Storage method'
      }),
    };
  }

  try {
    console.log('📦 Parsing JSON...');
    const { fileName, fileData, mimeType } = JSON.parse(event.body);
    
    console.log('File details:', {
      fileName: fileName?.substring(0, 30) + '...',
      mimeType,
      fileDataLength: fileData?.length || 0
    });

    if (!fileName || !fileData || !mimeType) {
      console.log('❌ Missing required fields');
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing fileName, fileData, or mimeType' }),
      };
    }

    // AJUTISELT TAGASTA MOCK VASTUS testimiseks
    console.log('✅ All checks passed, returning mock response');
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        fileUri: 'files/mock-test-file-123',
        method: 'gemini_files_api',
        message: 'MOCK RESPONSE - function works!'
      }),
    };

  } catch (parseError) {
    console.error('💥 JSON Parse error:', parseError.message);
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: 'Invalid JSON in request body',
        details: parseError.message
      }),
    };
  }
};
