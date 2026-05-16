const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = file.mimetype.startsWith('video/') ? 'videos' : 'photos';
    const dir = path.join(__dirname, `../uploads/${type}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const uploadMedia = multer({ storage: mediaStorage, limits: { fileSize: 100 * 1024 * 1024 } });

async function findPost(postId, userId) {
  return prisma.scheduledPost.findFirst({
    where: { id: postId, client: { userId } },
  });
}

// GET /api/posts?clientId=&status=&upcoming=&limit=
router.get('/', auth, async (req, res) => {
  try {
    const { clientId, status, upcoming, limit = 50 } = req.query;
    const where = { client: { userId: req.userId } };
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;
    if (upcoming === 'true') {
      where.scheduledFor = { gte: new Date() };
      where.status = { in: ['pending', 'uploaded'] };
    }

    const posts = await prisma.scheduledPost.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { scheduledFor: 'asc' },
      take: Number(limit),
    });
    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// GET /api/posts/campaign/:campaignId
router.get('/campaign/:campaignId', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {
      campaignId: req.params.campaignId,
      client: { userId: req.userId },
    };
    if (status) where.status = status;

    const posts = await prisma.scheduledPost.findMany({
      where,
      orderBy: { scheduledFor: 'asc' },
    });
    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load campaign posts' });
  }
});

// POST /api/posts/:id/media
router.post('/:id/media', auth, uploadMedia.array('media', 10), async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const firstFile = req.files[0];
    const isVideo = firstFile.mimetype.startsWith('video/');
    const mediaType = isVideo ? 'video' : (req.files.length > 1 ? 'carousel' : 'photo');
    const subdir = isVideo ? 'videos' : 'photos';
    const mediaUrls = req.files.map(f => `/uploads/${subdir}/${f.filename}`);

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { mediaType, mediaUrls, status: 'uploaded' },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// PUT /api/posts/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { caption, postToStory } = req.body;
    const data = {};
    if (caption !== undefined) data.caption = caption;
    if (postToStory !== undefined) data.postToStory = postToStory;

    const updated = await prisma.scheduledPost.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// DELETE /api/posts/:id/media
router.delete('/:id/media', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (['posting', 'posted'].includes(post.status)) {
      return res.status(400).json({ error: 'Cannot remove media from a posting or posted slot' });
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { mediaType: null, mediaUrls: [], status: 'pending' },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove media' });
  }
});

// POST /api/posts/:id/unpost (Meta deletion wired in Phase 2)
router.post('/:id/unpost', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'posted') {
      return res.status(400).json({ error: 'Post has not been published yet' });
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { status: 'uploaded', instagramResult: null, facebookResult: null },
    });
    res.json({ message: 'Post reverted to uploaded status', post: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unpost' });
  }
});

module.exports = router;
