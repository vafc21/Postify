const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/authMiddleware');
const { encrypt, decrypt, maskKey } = require('../utils/encryption');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/settings — fetch current API key settings (masked)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const apiKeys = await prisma.apiKey.findUnique({
      where: { userId: req.userId },
    });

    if (!apiKeys) {
      return res.json({
        groqKey: null,
        openaiKey: null,
        claudeKey: null,
        preferredTranscription: 'groq',
      });
    }

    // Decrypt for masking only — never return raw keys
    const groqDecrypted = decrypt(apiKeys.groqKey);
    const openaiDecrypted = decrypt(apiKeys.openaiKey);
    const claudeDecrypted = decrypt(apiKeys.claudeKey);

    res.json({
      groqKey: groqDecrypted ? maskKey(groqDecrypted) : null,
      openaiKey: openaiDecrypted ? maskKey(openaiDecrypted) : null,
      claudeKey: claudeDecrypted ? maskKey(claudeDecrypted) : null,
      preferredTranscription: apiKeys.preferredTranscription,
      hasGroqKey: !!groqDecrypted,
      hasOpenaiKey: !!openaiDecrypted,
      hasClaudeKey: !!claudeDecrypted,
    });
  } catch (err) {
    console.error('Settings GET error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST /api/settings/transcription — save transcription API keys
router.post('/transcription', authMiddleware, async (req, res) => {
  try {
    const { groqKey, openaiKey, preferredTranscription } = req.body;

    const updateData = {};

    // Only update keys if new values are provided (non-masked)
    if (groqKey && !groqKey.includes('••••')) {
      updateData.groqKey = encrypt(groqKey.trim());
    } else if (groqKey === '') {
      updateData.groqKey = null;
    }

    if (openaiKey && !openaiKey.includes('••••')) {
      updateData.openaiKey = encrypt(openaiKey.trim());
    } else if (openaiKey === '') {
      updateData.openaiKey = null;
    }

    if (preferredTranscription) {
      updateData.preferredTranscription = preferredTranscription;
    }

    await prisma.apiKey.upsert({
      where: { userId: req.userId },
      update: updateData,
      create: { userId: req.userId, ...updateData },
    });

    res.json({ message: 'Transcription settings saved successfully' });
  } catch (err) {
    console.error('Settings POST transcription error:', err);
    res.status(500).json({ error: 'Failed to save transcription settings' });
  }
});

// POST /api/settings/claude — save Claude API key
router.post('/claude', authMiddleware, async (req, res) => {
  try {
    const { claudeKey } = req.body;

    const updateData = {};

    if (claudeKey && !claudeKey.includes('••••')) {
      updateData.claudeKey = encrypt(claudeKey.trim());
    } else if (claudeKey === '') {
      updateData.claudeKey = null;
    }

    await prisma.apiKey.upsert({
      where: { userId: req.userId },
      update: updateData,
      create: { userId: req.userId, ...updateData },
    });

    res.json({ message: 'Claude API key saved successfully' });
  } catch (err) {
    console.error('Settings POST claude error:', err);
    res.status(500).json({ error: 'Failed to save Claude API key' });
  }
});

// DELETE /api/settings/key/:keyType — remove a specific key
router.delete('/key/:keyType', authMiddleware, async (req, res) => {
  try {
    const { keyType } = req.params;
    const validKeys = ['groqKey', 'openaiKey', 'claudeKey'];

    if (!validKeys.includes(keyType)) {
      return res.status(400).json({ error: 'Invalid key type' });
    }

    await prisma.apiKey.upsert({
      where: { userId: req.userId },
      update: { [keyType]: null },
      create: { userId: req.userId },
    });

    res.json({ message: `${keyType} removed successfully` });
  } catch (err) {
    console.error('Settings DELETE key error:', err);
    res.status(500).json({ error: 'Failed to remove key' });
  }
});

module.exports = router;
