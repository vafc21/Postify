const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { getLongLivedToken, getPagesAndIgAccounts } = require('../services/meta');
const { encrypt, decrypt } = require('../utils/encryption');

const router = express.Router();

const GRAPH_AUTH = 'https://www.facebook.com/v18.0/dialog/oauth';
const SCOPES = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';

// GET /api/oauth/clients/:clientId/connect/:platform
router.get('/clients/:clientId/connect/:platform', auth, async (req, res) => {
  try {
    const { clientId, platform } = req.params;
    if (!['instagram', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.metaAppId || !user?.metaAppSecret) {
      return res.status(400).json({ error: 'Set Meta App ID and Secret in Settings first' });
    }

    const state = jwt.sign(
      { clientId, platform, userId: req.userId },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    const redirectUri = `${process.env.SERVER_URL || 'http://localhost:5000'}/api/oauth/callback`;
    const url = `${GRAPH_AUTH}?client_id=${user.metaAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${SCOPES}&state=${state}&response_type=code`;

    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

// GET /api/oauth/callback
router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

  if (oauthError) {
    return res.redirect(`${CLIENT_URL}/oauth-result?error=${encodeURIComponent(oauthError)}`);
  }

  let clientId, platform, userId;
  try {
    ({ clientId, platform, userId } = jwt.verify(state, process.env.JWT_SECRET));
  } catch (err) {
    console.error('OAuth state verification failed:', err.message);
    return res.redirect(`${CLIENT_URL}/oauth-result?error=invalid_state`);
  }

  try {
    // Re-verify the client really belongs to the user from the state JWT
    const clientCheck = await prisma.client.findFirst({ where: { id: clientId, userId } });
    if (!clientCheck) {
      return res.redirect(`${CLIENT_URL}/oauth-result?error=invalid_state`);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.metaAppId || !user?.metaAppSecret) {
      return res.redirect(`${CLIENT_URL}/oauth-result?error=missing_app_credentials`);
    }

    const redirectUri = `${process.env.SERVER_URL || 'http://localhost:5000'}/api/oauth/callback`;
    const appSecret = decrypt(user.metaAppSecret);

    let tokenData;
    try {
      const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: user.metaAppId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        },
      });
      tokenData = response.data;
    } catch (err) {
      console.error('OAuth token exchange failed:', err.response?.data || err.message);
      return res.redirect(`${CLIENT_URL}/oauth-result?error=token_exchange_failed`);
    }

    let longLived;
    try {
      longLived = await getLongLivedToken(tokenData.access_token, user.metaAppId, appSecret);
    } catch (err) {
      console.error('Long-lived token exchange failed:', err.response?.data || err.message);
      return res.redirect(`${CLIENT_URL}/oauth-result?error=long_token_failed`);
    }
    const longToken = longLived.access_token;
    const expiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000)
      : null;

    let pages;
    try {
      pages = await getPagesAndIgAccounts(longToken);
    } catch (err) {
      console.error('Get pages failed:', err.response?.data || err.message);
      return res.redirect(`${CLIENT_URL}/oauth-result?error=pages_fetch_failed`);
    }

    if (pages.length === 0) {
      return res.redirect(`${CLIENT_URL}/oauth-result?error=no_pages_found`);
    }

    const page = pages[0];
    const igAccountId = page.instagram_business_account?.id || null;

    const rawToken = platform === 'facebook' ? page.access_token : longToken;
    const tokenRecord = {
      clientId,
      platform,
      accessToken: encrypt(rawToken),
      expiresAt,
      pageId: page.id,
      instagramAccountId: igAccountId,
    };

    await prisma.clientToken.upsert({
      where: { clientId_platform: { clientId, platform } },
      update: tokenRecord,
      create: tokenRecord,
    });

    res.redirect(`${CLIENT_URL}/oauth-result?success=true&clientId=${clientId}&platform=${platform}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/oauth-result?error=oauth_failed`);
  }
});

// DELETE /api/oauth/clients/:clientId/tokens/:platform
router.delete('/clients/:clientId/tokens/:platform', auth, async (req, res) => {
  try {
    const { clientId, platform } = req.params;
    const client = await prisma.client.findFirst({ where: { id: clientId, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    await prisma.clientToken.deleteMany({ where: { clientId, platform } });
    res.json({ message: `${platform} disconnected` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;
