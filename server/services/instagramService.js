const axios = require('axios');
const { getValidToken } = require('../utils/tokenRefresh');
const { decrypt } = require('../utils/encryption');
const prisma = require('../utils/prisma');

const GRAPH_API = 'https://graph.facebook.com/v19.0';

/**
 * Post a video to Instagram Reels using the Content Publishing API.
 * Flow: Create media container → Wait for processing → Publish
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.filePath - Local path to video file
 * @param {object} params.captions - { caption, hashtags }
 * @param {string} params.videoPublicUrl - Publicly accessible URL for the video (required by Instagram)
 * @returns {Promise<object>} { success, mediaId, error? }
 */
async function postToInstagram({ userId, filePath, captions, videoPublicUrl }) {
  try {
    const accessToken = await getValidToken(userId, 'instagram');
    if (!accessToken) {
      return { success: false, error: 'Instagram not connected or token expired. Please reconnect.' };
    }

    const tokenRecord = await prisma.token.findUnique({
      where: { userId_platform: { userId, platform: 'instagram' } },
    });

    // refreshToken field stores the Instagram Business Account ID
    const igAccountId = tokenRecord?.refreshToken
      ? decrypt(tokenRecord.refreshToken)
      : null;

    if (!igAccountId) {
      return {
        success: false,
        error: 'Instagram Business Account ID not found. Please reconnect Instagram.',
      };
    }

    if (!videoPublicUrl) {
      return {
        success: false,
        error: 'No public video URL provided for Instagram upload.',
      };
    }

    const captionText = `${captions.caption || ''}\n\n${captions.hashtags || ''}`.trim();

    // Step 1: Create a Reels container
    const containerRes = await axios.post(`${GRAPH_API}/${igAccountId}/media`, null, {
      params: {
        media_type: 'REELS',
        video_url: videoPublicUrl,
        caption: captionText.substring(0, 2200),
        share_to_feed: true,
        access_token: accessToken,
      },
    });

    const containerId = containerRes.data.id;
    if (!containerId) {
      return { success: false, error: 'Failed to create Instagram media container' };
    }

    // Step 2: Poll for container status (Instagram needs time to process video)
    let status = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = 24; // up to 2 minutes (5s intervals)

    while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await axios.get(`${GRAPH_API}/${containerId}`, {
        params: {
          fields: 'status_code',
          access_token: accessToken,
        },
      });
      status = statusRes.data.status_code;
      attempts++;
    }

    if (status !== 'FINISHED') {
      return {
        success: false,
        error: `Instagram video processing failed. Final status: ${status}`,
      };
    }

    // Step 3: Publish the container
    const publishRes = await axios.post(`${GRAPH_API}/${igAccountId}/media_publish`, null, {
      params: {
        creation_id: containerId,
        access_token: accessToken,
      },
    });

    const mediaId = publishRes.data.id;
    return {
      success: true,
      mediaId,
      mediaUrl: `https://www.instagram.com/p/${mediaId}/`,
    };
  } catch (err) {
    console.error('Instagram upload error:', err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message || 'Instagram upload failed',
    };
  }
}

module.exports = { postToInstagram };
