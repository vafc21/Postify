const { google } = require('googleapis');
const fs = require('fs');
const { getValidToken } = require('../utils/tokenRefresh');
const { decrypt } = require('../utils/encryption');
const prisma = require('../utils/prisma');


/**
 * Upload a video to YouTube Shorts.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.filePath - Local path to video file
 * @param {object} params.captions - { title, description, tags }
 * @returns {Promise<object>} { success, videoId, videoUrl, error? }
 */
async function postToYouTube({ userId, filePath, captions }) {
  try {
    const accessToken = await getValidToken(userId, 'youtube');
    if (!accessToken) {
      return { success: false, error: 'YouTube not connected or token expired. Please reconnect.' };
    }

    const tokenRecord = await prisma.token.findUnique({
      where: { userId_platform: { userId, platform: 'youtube' } },
    });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: tokenRecord?.refreshToken ? decrypt(tokenRecord.refreshToken) : undefined,
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const title = captions.title?.substring(0, 100) || 'My YouTube Short';
    const description = captions.description || '';
    const tags = Array.isArray(captions.tags) ? captions.tags : [];

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId: '22', // People & Blogs — common for Shorts
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    });

    const videoId = response.data.id;
    return {
      success: true,
      videoId,
      videoUrl: `https://www.youtube.com/shorts/${videoId}`,
      title,
    };
  } catch (err) {
    console.error('YouTube upload error:', err.message);
    return {
      success: false,
      error: err.message || 'YouTube upload failed',
    };
  }
}

module.exports = { postToYouTube };
