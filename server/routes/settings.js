const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { encrypt, maskKey } = require('../utils/encryption');

const router = express.Router();

// GET /api/settings
router.get('/', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, metaAppId: true, metaAppSecret: true, theme: true, timezone: true, notificationWebhookUrl: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Mask the secret before returning — never expose plaintext or encrypted value
    const response = { ...user };
    if (response.metaAppSecret) {
      response.metaAppSecret = maskKey(response.metaAppSecret);
    }
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// PUT /api/settings
router.put('/', auth, async (req, res) => {
  try {
    const { metaAppId, metaAppSecret, theme, password, timezone, notificationWebhookUrl } = req.body;
    const data = {};

    if (metaAppId !== undefined) data.metaAppId = metaAppId;
    if (metaAppSecret !== undefined) data.metaAppSecret = encrypt(metaAppSecret);
    if (theme && ['dark', 'light'].includes(theme)) data.theme = theme;
    if (timezone !== undefined) data.timezone = timezone;
    if (notificationWebhookUrl !== undefined) data.notificationWebhookUrl = notificationWebhookUrl || null;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      data.passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data,
      select: { id: true, email: true, metaAppId: true, theme: true, timezone: true, notificationWebhookUrl: true },
    });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
