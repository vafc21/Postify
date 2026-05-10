const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('./encryption');

const prisma = new PrismaClient();

/**
 * Refresh a YouTube (Google) access token using the stored refresh token.
 */
async function refreshYouTubeToken(userId) {
  const { google } = require('googleapis');

  const tokenRecord = await prisma.token.findUnique({
    where: { userId_platform: { userId, platform: 'youtube' } },
  });
  if (!tokenRecord) throw new Error('No YouTube token found for user');

  const refreshToken = decrypt(tokenRecord.refreshToken);
  if (!refreshToken) throw new Error('Cannot decrypt YouTube refresh token');

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.SERVER_URL}/api/oauth/youtube/callback`
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  await prisma.token.update({
    where: { userId_platform: { userId, platform: 'youtube' } },
    data: {
      accessToken: encrypt(credentials.access_token),
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : null,
    },
  });

  return credentials.access_token;
}

/**
 * Refresh a Meta (Instagram) access token.
 * Meta long-lived tokens last 60 days and can be refreshed.
 */
async function refreshInstagramToken(userId) {
  const axios = require('axios');

  const tokenRecord = await prisma.token.findUnique({
    where: { userId_platform: { userId, platform: 'instagram' } },
  });
  if (!tokenRecord) throw new Error('No Instagram token found for user');

  const accessToken = decrypt(tokenRecord.accessToken);
  if (!accessToken) throw new Error('Cannot decrypt Instagram access token');

  const response = await axios.get(
    'https://graph.instagram.com/refresh_access_token',
    {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: accessToken,
      },
    }
  );

  const newToken = response.data.access_token;
  const expiresIn = response.data.expires_in; // seconds

  await prisma.token.update({
    where: { userId_platform: { userId, platform: 'instagram' } },
    data: {
      accessToken: encrypt(newToken),
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : null,
    },
  });

  return newToken;
}

/**
 * Refresh a TikTok access token using the stored refresh token.
 */
async function refreshTikTokToken(userId) {
  const axios = require('axios');

  const tokenRecord = await prisma.token.findUnique({
    where: { userId_platform: { userId, platform: 'tiktok' } },
  });
  if (!tokenRecord) throw new Error('No TikTok token found for user');

  const refreshToken = decrypt(tokenRecord.refreshToken);
  if (!refreshToken) throw new Error('Cannot decrypt TikTok refresh token');

  const response = await axios.post(
    'https://open.tiktokapis.com/v2/oauth/token/',
    new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_ID,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;

  await prisma.token.update({
    where: { userId_platform: { userId, platform: 'tiktok' } },
    data: {
      accessToken: encrypt(access_token),
      refreshToken: refresh_token ? encrypt(refresh_token) : undefined,
      expiresAt: expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : null,
    },
  });

  return access_token;
}

/**
 * Get a valid access token for a platform, refreshing if expired.
 */
async function getValidToken(userId, platform) {
  const tokenRecord = await prisma.token.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!tokenRecord) return null;

  const isExpired =
    tokenRecord.expiresAt && new Date() >= new Date(tokenRecord.expiresAt);

  if (!isExpired) {
    return decrypt(tokenRecord.accessToken);
  }

  // Attempt refresh
  try {
    if (platform === 'youtube') return await refreshYouTubeToken(userId);
    if (platform === 'instagram') return await refreshInstagramToken(userId);
    if (platform === 'tiktok') return await refreshTikTokToken(userId);
  } catch (err) {
    console.error(`Token refresh failed for ${platform}:`, err.message);
    return null;
  }

  return null;
}

module.exports = {
  refreshYouTubeToken,
  refreshInstagramToken,
  refreshTikTokToken,
  getValidToken,
};
