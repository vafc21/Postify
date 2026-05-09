const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

/**
 * Transcribe a video/audio file using Groq Whisper API
 */
async function transcribeWithGroq(filePath, apiKey) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'text');

  const response = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  return typeof response.data === 'string'
    ? response.data
    : response.data.text || '';
}

/**
 * Transcribe a video/audio file using OpenAI Whisper API
 */
async function transcribeWithOpenAI(filePath, apiKey) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  return typeof response.data === 'string'
    ? response.data
    : response.data.text || '';
}

/**
 * Determine which transcription service to use and run it.
 * @param {string} filePath - Path to the video/audio file
 * @param {object} apiKeys - Decrypted API keys from the database
 * @returns {Promise<string>} transcript text
 */
async function transcribe(filePath, apiKeys) {
  const { groqKey, openaiKey, preferredTranscription } = apiKeys;

  if (!groqKey && !openaiKey) {
    const err = new Error(
      'No transcription API key configured. Please add a Groq or OpenAI API key in Settings.'
    );
    err.status = 400;
    throw err;
  }

  // If user has both keys, use their preferred choice
  if (groqKey && openaiKey) {
    if (preferredTranscription === 'openai') {
      return transcribeWithOpenAI(filePath, openaiKey);
    }
    return transcribeWithGroq(filePath, groqKey);
  }

  // Only one key available — use it
  if (groqKey) return transcribeWithGroq(filePath, groqKey);
  return transcribeWithOpenAI(filePath, openaiKey);
}

module.exports = { transcribe, transcribeWithGroq, transcribeWithOpenAI };
