const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const prisma = require('../utils/prisma');
const authMiddleware = require('../middleware/authMiddleware');
const { encrypt } = require('../utils/encryption');

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getServerUrl() {
  return process.env.SERVER_URL || 'http://localhost:5000';
}

function getClientUrl() {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

// ─── YOUTUBE ─────────────────────────────────────────────────────────────────

function getYouTubeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${getServerUrl()}/api/oauth/youtube/callback`
  );
}

// GET /api/oauth/youtube — initiate YouTube OAuth
router.get('/youtube', authMiddleware, (req, res) => {
  const oauth2Client = getYouTubeOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    state: req.userId,
    prompt: 'consent',
  });
  res.redirect(url);
});

// GET /api/oauth/youtube/callback
router.get('/youtube/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error || !code) {
    return res.redirect(`${getClientUrl()}/dashboard?error=youtube_auth_failed`);
  }

  try {
    const oauth2Client = getYouTubeOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    await prisma.token.upsert({
      where: { userId_platform: { userId, platform: 'youtube' } },
      update: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      create: {
        userId,
        platform: 'youtube',
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });

    res.redirect(`${getClientUrl()}/dashboard?connected=youtube`);
  } catch (err) {
    console.error('YouTube OAuth callback error:', err);
    res.redirect(`${getClientUrl()}/dashboard?error=youtube_auth_failed`);
  }
});

// ─── INSTAGRAM (META) ────────────────────────────────────────────────────────

// GET /api/oauth/instagram — initiate Instagram OAuth
router.get('/instagram', authMiddleware, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.META_CLIENT_ID,
    redirect_uri: `${getServerUrl()}/api/oauth/instagram/callback`,
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,instagram_manage_insights',
    response_type: 'code',
    state: req.userId,
  });
  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
});

// GET /api/oauth/instagram/callback
router.get('/instagram/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error || !code) {
    return res.redirect(`${getClientUrl()}/dashboard?error=instagram_auth_failed`);
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await axios.post(
      'https://graph.facebook.com/v19.0/oauth/access_token',
      null,
      {
        params: {
          client_id: process.env.META_CLIENT_ID,
          client_secret: process.env.META_CLIENT_SECRET,
          redirect_uri: `${getServerUrl()}/api/oauth/instagram/callback`,
          code,
        },
      }
    );

    const shortToken = tokenRes.data.access_token;

    // Exchange for long-lived token (60 days)
    const longTokenRes = await axios.get(
      'https://graph.facebook.com/v19.0/oauth/access_token',
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: process.env.META_CLIENT_ID,
          client_secret: process.env.META_CLIENT_SECRET,
          fb_exchange_token: shortToken,
        },
      }
    );

    const longToken = longTokenRes.data.access_token;
    const expiresIn = longTokenRes.data.expires_in; // seconds

    // Get the Instagram Business Account ID
    const meRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: longToken },
    });

    const pages = meRes.data.data || [];
    let igAccountId = null;

    for (const page of pages) {
      try {
        const igRes = await axios.get(
          `https://graph.facebook.com/v19.0/${page.id}`,
          {
            params: {
              fields: 'instagram_business_account',
              access_token: page.access_token || longToken,
            },
          }
        );
        if (igRes.data.instagram_business_account) {
          igAccountId = igRes.data.instagram_business_account.id;
          break;
        }
      } catch (_) { /* skip page */ }
    }

    await prisma.token.upsert({
      where: { userId_platform: { userId, platform: 'instagram' } },
      update: {
        accessToken: encrypt(longToken),
        refreshToken: igAccountId ? encrypt(igAccountId) : null,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      },
      create: {
        userId,
        platform: 'instagram',
        accessToken: encrypt(longToken),
        refreshToken: igAccountId ? encrypt(igAccountId) : null,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      },
    });

    res.redirect(`${getClientUrl()}/dashboard?connected=instagram`);
  } catch (err) {
    console.error('Instagram OAuth callback error:', err.response?.data || err.message);
    res.redirect(`${getClientUrl()}/dashboard?error=instagram_auth_failed`);
  }
});

// ─── TIKTOK ──────────────────────────────────────────────────────────────────

// GET /api/oauth/tiktok — initiate TikTok OAuth
router.get('/tiktok', authMiddleware, (req, res) => {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_ID,
    redirect_uri: `${getServerUrl()}/api/oauth/tiktok/callback`,
    scope: 'user.info.basic,video.upload,video.publish',
    response_type: 'code',
    state: req.userId,
  });
  res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
});

// GET /api/oauth/tiktok/callback
router.get('/tiktok/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error || !code) {
    return res.redirect(`${getClientUrl()}/dashboard?error=tiktok_auth_failed`);
  }

  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_ID,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${getServerUrl()}/api/oauth/tiktok/callback`,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    await prisma.token.upsert({
      where: { userId_platform: { userId, platform: 'tiktok' } },
      update: {
        accessToken: encrypt(access_token),
        refreshToken: refresh_token ? encrypt(refresh_token) : null,
        expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
      },
      create: {
        userId,
        platform: 'tiktok',
        accessToken: encrypt(access_token),
        refreshToken: refresh_token ? encrypt(refresh_token) : null,
        expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
      },
    });

    res.redirect(`${getClientUrl()}/dashboard?connected=tiktok`);
  } catch (err) {
    console.error('TikTok OAuth callback error:', err.response?.data || err.message);
    res.redirect(`${getClientUrl()}/dashboard?error=tiktok_auth_failed`);
  }
});

// ─── STATUS ──────────────────────────────────────────────────────────────────

// GET /api/oauth/status — check which platforms are connected
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const tokens = await prisma.token.findMany({
      where: { userId: req.userId },
      select: { platform: true, expiresAt: true },
    });

    const status = { youtube: false, instagram: false, tiktok: false };
    for (const t of tokens) {
      const expired = t.expiresAt && new Date() > new Date(t.expiresAt);
      status[t.platform] = !expired;
    }

    res.json(status);
  } catch (err) {
    console.error('OAuth status error:', err);
    res.status(500).json({ error: 'Failed to fetch connection status' });
  }
});

// DELETE /api/oauth/:platform — disconnect a platform
router.delete('/:platform', authMiddleware, async (req, res) => {
  const { platform } = req.params;
  const valid = ['youtube', 'instagram', 'tiktok'];
  if (!valid.includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  try {
    await prisma.token.deleteMany({
      where: { userId: req.userId, platform },
    });
    res.json({ message: `${platform} disconnected` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect platform' });
  }
});

module.exports = router;
