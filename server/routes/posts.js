const express = require('express');
const multer = require('multer');
const { MulterError } = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { deleteIgPost, deleteFbPost, searchPlaces } = require('../services/meta');
const { readToken, decrypt } = require('../utils/encryption');

const router = express.Router();

const MEDIA_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = file.mimetype.startsWith('video/') ? 'videos' : 'photos';
    const dir = path.join(__dirname, `../uploads/${type}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // Force the extension from the validated MIME type so users can't drop
  // arbitrary file types (e.g. .html) into /uploads.
  filename: (req, file, cb) => {
    const ext = MEDIA_EXTENSIONS[file.mimetype];
    cb(null, `${uuidv4()}${ext}`);
  },
});
const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MEDIA_EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPG, PNG, GIF, WebP, MP4, or MOV.`));
  },
});

function unlinkMediaFiles(mediaUrls = []) {
  for (const url of mediaUrls) {
    if (!url || !url.startsWith('/uploads/')) continue;
    const abs = path.join(__dirname, '..', url);
    fs.unlink(abs, (err) => {
      if (err && err.code !== 'ENOENT') console.warn(`Failed to delete media ${abs}:`, err.message);
    });
  }
}

function runUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err) {
        // fileFilter rejections come through as regular Errors — surface them to the client
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  };
}

async function findPost(postId, userId) {
  return prisma.scheduledPost.findFirst({
    where: { id: postId, client: { userId } },
  });
}

// GET /api/posts/places/search?clientId=&q=
// Typeahead place search for location tagging. Uses the client's connected Meta
// token so results are scoped to a real account.
router.get('/places/search', auth, async (req, res) => {
  try {
    const { clientId, q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });

    const client = await prisma.client.findFirst({
      where: { id: clientId, userId: req.userId },
      include: { tokens: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Prefer the Instagram token (a long-lived user token); fall back to Facebook.
    const tokenRecord = client.tokens.find(t => t.platform === 'instagram')
      || client.tokens.find(t => t.platform === 'facebook');
    if (!tokenRecord) {
      return res.status(400).json({ error: 'Connect Instagram or Facebook for this client first' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const appSecret = decrypt(user?.metaAppSecret);
    if (!appSecret) return res.status(400).json({ error: 'Set your Meta App Secret in Settings first' });

    const places = await searchPlaces(q.trim(), readToken(tokenRecord.accessToken), appSecret);
    res.json(places);
  } catch (err) {
    console.error('Place search failed:', err.response?.data || err.message);
    res.status(502).json({ error: 'Place search failed' });
  }
});

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
      take: Math.min(Math.max(Number(limit) || 50, 1), 200),
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
router.post('/:id/media', auth, runUpload(uploadMedia.array('media', 10)), async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const firstFile = req.files[0];
    const isVideo = firstFile.mimetype.startsWith('video/');
    const mediaType = isVideo ? 'video' : (req.files.length > 1 ? 'carousel' : 'photo');
    const subdir = isVideo ? 'videos' : 'photos';
    const mediaUrls = req.files.map(f => `/uploads/${subdir}/${f.filename}`);

    // Delete the old media files (if any) before replacing
    unlinkMediaFiles(post.mediaUrls || []);

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { mediaType, mediaUrls, status: 'uploaded', attempts: 0 },
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

    const { caption, postToStory, location, locationId, storyLink, thumbOffset } = req.body;
    const data = {};
    if (caption !== undefined) data.caption = caption;
    if (postToStory !== undefined) data.postToStory = postToStory;
    if (location !== undefined) data.location = location;
    if (locationId !== undefined) data.locationId = locationId;
    if (storyLink !== undefined) data.storyLink = storyLink;
    if (thumbOffset !== undefined) data.thumbOffset = thumbOffset === '' ? null : Number(thumbOffset);

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

    unlinkMediaFiles(post.mediaUrls || []);

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { mediaType: null, mediaUrls: [], status: 'pending', attempts: 0 },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove media' });
  }
});

// POST /api/posts/:id/unpost
router.post('/:id/unpost', auth, async (req, res) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, client: { userId: req.userId } },
      include: { client: { select: { userId: true } } },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'posted') {
      return res.status(400).json({ error: 'Post has not been published yet' });
    }

    const tokens = await prisma.clientToken.findMany({ where: { clientId: post.clientId } });
    const errors = [];

    const igToken = tokens.find(t => t.platform === 'instagram');
    if (igToken && post.instagramResult?.feed?.mediaId) {
      try {
        await deleteIgPost(post.instagramResult.feed.mediaId, readToken(igToken.accessToken));
      } catch (err) {
        errors.push(`Instagram: ${err.response?.data?.error?.message || err.message}`);
      }
    }

    const fbToken = tokens.find(t => t.platform === 'facebook');
    if (fbToken && post.facebookResult?.feed?.postId) {
      try {
        await deleteFbPost(post.facebookResult.feed.postId, readToken(fbToken.accessToken));
      } catch (err) {
        errors.push(`Facebook: ${err.response?.data?.error?.message || err.message}`);
      }
    }

    const igDeleted = igToken && post.instagramResult?.feed?.mediaId && !errors.find(e => e.startsWith('Instagram:'));
    const fbDeleted = fbToken && post.facebookResult?.feed?.postId && !errors.find(e => e.startsWith('Facebook:'));
    const nothingToDelete = (!igToken || !post.instagramResult?.feed?.mediaId) && (!fbToken || !post.facebookResult?.feed?.postId);

    if (!nothingToDelete && errors.length > 0 && !igDeleted && !fbDeleted) {
      // All relevant deletes failed — don't wipe the DB record
      return res.status(502).json({
        message: 'Failed to unpost from all platforms',
        errors,
      });
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { status: 'uploaded', instagramResult: null, facebookResult: null },
    });

    res.json({
      message: errors.length ? 'Partial unpost — some platforms failed' : 'Unposted successfully',
      errors,
      post: updated,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unpost' });
  }
});

module.exports = router;
