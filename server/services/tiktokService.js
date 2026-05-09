const axios = require('axios');
const fs = require('fs');
const { getValidToken } = require('../utils/tokenRefresh');

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

/**
 * Post a video to TikTok using the Content Posting API (direct upload).
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.filePath - Local path to video file
 * @param {object} params.captions - { caption } (max 150 chars)
 * @returns {Promise<object>} { success, publishId, error? }
 */
async function postToTikTok({ userId, filePath, captions }) {
  try {
    const accessToken = await getValidToken(userId, 'tiktok');
    if (!accessToken) {
      return { success: false, error: 'TikTok not connected or token expired. Please reconnect.' };
    }

    const caption = (captions.caption || '').substring(0, 150);
    const fileSize = fs.statSync(filePath).size;

    // Step 1: Initialize upload and get upload URL
    const initRes = await axios.post(
      `${TIKTOK_API}/post/publish/video/init/`,
      {
        post_info: {
          title: caption,
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize, // single chunk upload for simplicity
          total_chunk_count: 1,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      }
    );

    const { publish_id, upload_url } = initRes.data?.data || {};

    if (!publish_id || !upload_url) {
      return { success: false, error: 'TikTok: Failed to get upload URL' };
    }

    // Step 2: Upload video binary
    const videoBuffer = fs.readFileSync(filePath);
    await axios.put(upload_url, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Length': fileSize,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    // Step 3: Poll for publish status
    let status = 'PROCESSING_UPLOAD';
    let attempts = 0;
    const maxAttempts = 24;

    while (
      (status === 'PROCESSING_UPLOAD' || status === 'PROCESSING_PUBLISH') &&
      attempts < maxAttempts
    ) {
      await new Promise((r) => setTimeout(r, 5000));

      const statusRes = await axios.post(
        `${TIKTOK_API}/post/publish/status/fetch/`,
        { publish_id },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
        }
      );

      status = statusRes.data?.data?.status;
      attempts++;
    }

    if (status === 'PUBLISH_COMPLETE') {
      return { success: true, publishId: publish_id };
    } else {
      return {
        success: false,
        error: `TikTok publish did not complete. Status: ${status}`,
      };
    }
  } catch (err) {
    console.error('TikTok upload error:', err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message || 'TikTok upload failed',
    };
  }
}

module.exports = { postToTikTok };
