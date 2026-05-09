const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/authMiddleware');
const { decrypt } = require('../utils/encryption');
const { transcribe } = require('../services/transcriptionService');
const { generateCaptions } = require('../services/claudeService');
const { postToYouTube } = require('../services/youtubeService');
const { postToInstagram } = require('../services/instagramService');
const { postToTikTok } = require('../services/tiktokService');

const router = express.Router();
const prisma = new PrismaClient();

// Configure multer for local storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.userId}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed (mp4, mov, avi, webm, mkv)'));
    }
  },
});

function safeDeleteFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed to delete file:', filePath, err.message);
  }
}

// POST /api/upload — main upload + pipeline endpoint
router.post('/', authMiddleware, upload.single('video'), async (req, res) => {
  const filePath = req.file?.path;

  try {
    const { description, platforms: platformsRaw } = req.body;

    let platforms = [];
    try {
      platforms = JSON.parse(platformsRaw);
    } catch {
      platforms = (platformsRaw || '').split(',').map((p) => p.trim()).filter(Boolean);
    }

    if (!platforms.length) {
      safeDeleteFile(filePath);
      return res.status(400).json({ error: 'Please select at least one platform' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Create a post record immediately
    const post = await prisma.post.create({
      data: {
        userId: req.userId,
        description,
        platforms,
        status: 'processing',
      },
    });

    // Run the pipeline asynchronously and stream progress via SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    function sendProgress(step, message, data = {}) {
      res.write(`data: ${JSON.stringify({ step, message, ...data })}\n\n`);
    }

    try {
      // ── Step 1: File received ────────────────────────────────────────────
      sendProgress(1, 'Video uploaded successfully');

      // ── Step 2: Transcribe ───────────────────────────────────────────────
      sendProgress(2, 'Transcribing video...');

      const apiKeyRecord = await prisma.apiKey.findUnique({ where: { userId: req.userId } });
      if (!apiKeyRecord) {
        throw Object.assign(
          new Error('No API keys configured. Please add your transcription API key in Settings.'),
          { status: 400 }
        );
      }

      const decryptedKeys = {
        groqKey: decrypt(apiKeyRecord.groqKey),
        openaiKey: decrypt(apiKeyRecord.openaiKey),
        claudeKey: decrypt(apiKeyRecord.claudeKey),
        preferredTranscription: apiKeyRecord.preferredTranscription,
      };

      const transcript = await transcribe(filePath, decryptedKeys);
      sendProgress(2, 'Transcription complete', { transcriptLength: transcript?.length || 0 });

      // ── Step 3: Generate captions ────────────────────────────────────────
      sendProgress(3, 'Generating AI captions...');

      const captions = await generateCaptions({
        transcript,
        description,
        platforms,
        userClaudeKey: decryptedKeys.claudeKey,
      });

      sendProgress(3, 'Captions generated');

      // ── Step 4: Post to platforms ────────────────────────────────────────
      sendProgress(4, 'Posting to platforms...');

      const results = {};
      const postPromises = [];

      if (platforms.includes('youtube') && captions.youtube) {
        postPromises.push(
          postToYouTube({ userId: req.userId, filePath, captions: captions.youtube })
            .then((r) => { results.youtube = r; })
        );
      }

      if (platforms.includes('instagram') && captions.instagram) {
        // For Instagram, video must be publicly accessible. Build a temp URL.
        const videoPublicUrl = `${process.env.SERVER_URL}/uploads/${path.basename(filePath)}`;
        postPromises.push(
          postToInstagram({
            userId: req.userId,
            filePath,
            captions: captions.instagram,
            videoPublicUrl,
          }).then((r) => { results.instagram = r; })
        );
      }

      if (platforms.includes('tiktok') && captions.tiktok) {
        postPromises.push(
          postToTikTok({ userId: req.userId, filePath, captions: captions.tiktok })
            .then((r) => { results.tiktok = r; })
        );
      }

      await Promise.allSettled(postPromises);

      // ── Step 5: Store results and finalize ───────────────────────────────
      const anySuccess = Object.values(results).some((r) => r?.success);
      const finalStatus = anySuccess ? 'posted' : 'failed';

      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: finalStatus,
          youtubeResult: results.youtube || null,
          instagramResult: results.instagram || null,
          tiktokResult: results.tiktok || null,
        },
      });

      sendProgress(5, 'Done!', {
        postId: post.id,
        status: finalStatus,
        results,
        captions,
      });

    } catch (pipelineErr) {
      console.error('Pipeline error:', pipelineErr);

      await prisma.post.update({
        where: { id: post.id },
        data: { status: 'failed' },
      }).catch(() => {});

      sendProgress(0, 'error', {
        error: pipelineErr.message || 'Pipeline failed',
      });
    } finally {
      safeDeleteFile(filePath);
      res.end();
    }

  } catch (err) {
    safeDeleteFile(filePath);
    console.error('Upload route error:', err);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'Upload failed' });
    }
  }
});

module.exports = router;
