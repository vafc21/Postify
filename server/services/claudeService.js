const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are an AI assistant embedded in a multi-platform social media publishing tool. Your job is to help a content creator publish videos to YouTube Shorts, Instagram Reels, and TikTok simultaneously.

You will receive:
1. A video transcript extracted via Whisper
2. A short description written by the user about the video
3. A list of platforms the user wants to post to

Generate the following for EACH selected platform:

YOUTUBE SHORTS:
- Title: Max 100 characters. Punchy, SEO-friendly. No clickbait.
- Description: 2-3 sentences. Include 3-5 hashtags at the end.
- Tags: 10-15 comma-separated search tags.

INSTAGRAM REELS:
- Caption: Conversational, 1-3 short paragraphs. Hook in first line. End with a call to action.
- Hashtags: 20-30 relevant hashtags at the end.

TIKTOK:
- Caption: Max 150 characters. Casual tone. Include 5-8 hashtags.

RULES:
- Never copy transcript word for word
- Tailor tone per platform
- Never use generic hashtags alone
- Avoid robotic language
- Prioritize user description over transcript if they conflict
- Never make up facts not present in the transcript or description
- Return ONLY valid JSON in this exact format with no extra text:
{
  "youtube": { "title": "...", "description": "...", "tags": ["..."] },
  "instagram": { "caption": "...", "hashtags": "..." },
  "tiktok": { "caption": "..." }
}
Only include keys for platforms that were requested.`;

/**
 * Generate platform-specific captions using Claude API.
 *
 * @param {object} params
 * @param {string} params.transcript - Transcribed text from the video
 * @param {string} params.description - User-provided description
 * @param {string[]} params.platforms - Array of platform names ['youtube', 'instagram', 'tiktok']
 * @param {string|null} params.userClaudeKey - User's personal Anthropic API key (or null)
 * @returns {Promise<object>} Parsed JSON with platform-specific content
 */
async function generateCaptions({ transcript, description, platforms, userClaudeKey }) {
  // Use user's key if provided, otherwise fall back to app default
  const apiKey = userClaudeKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    const err = new Error(
      'No Claude API key available. Please add your Anthropic API key in Settings or contact the app administrator.'
    );
    err.status = 400;
    throw err;
  }

  const client = new Anthropic({ apiKey });

  const userMessage = `TRANSCRIPT:
${transcript || '(No transcript available)'}

USER DESCRIPTION:
${description || '(No description provided)'}

SELECTED PLATFORMS: ${platforms.join(', ')}

Please generate platform-specific content for the platforms listed above.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const rawText = message.content[0]?.text?.trim();

  if (!rawText) {
    throw new Error('Claude returned an empty response');
  }

  // Strip markdown code fences if present
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonText);
    return parsed;
  } catch (parseErr) {
    console.error('Claude JSON parse error. Raw response:', rawText);
    throw new Error('Failed to parse Claude response as JSON');
  }
}

module.exports = { generateCaptions };
