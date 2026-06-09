const express = require('express');
const multer = require('multer');
const { MulterError } = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { deleteIgPost, deleteFbPost, searchPlaces, graphErrorMessage } = require('../services/meta');
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

// Story background images live in their own folder so clearing post media never
// removes a custom story background.
const storyAssetStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/stories/assets');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}${MEDIA_EXTENSIONS[file.mimetype] || '.jpg'}`),
});
const uploadStoryAsset = multer({
  storage: storyAssetStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') && MEDIA_EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new Error('Story backgrounds must be an image (JPG, PNG, GIF, or WebP).'));
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

// Coerce a client-supplied story layout into a known, bounded shape before we
// store it. The renderer also clamps defensively, but validating here keeps the
// DB clean and stops oversized/garbage layouts (huge fonts, 10k elements, SSRF
// URLs) at the door. Returns null to clear, or throws on a non-object payload.
const BG_TYPES = new Set(['auto', 'color', 'gradient', 'image']);
const EL_TYPES = new Set(['post', 'text', 'mention']);
const TEXT_ALIGN = new Set(['left', 'center', 'right']);
const num = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

function sanitizeStoryLayout(input) {
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid story layout');

  const bgIn = input.background && typeof input.background === 'object' ? input.background : {};
  const bgType = BG_TYPES.has(bgIn.type) ? bgIn.type : 'auto';
  const background = { type: bgType };
  if (bgType === 'color' || bgType === 'gradient') background.value = typeof bgIn.value === 'string' ? bgIn.value.slice(0, 400) : '';
  if (bgType === 'image') background.url = typeof bgIn.url === 'string' && bgIn.url.startsWith('/uploads/') ? bgIn.url : null;

  const elements = (Array.isArray(input.elements) ? input.elements : [])
    .slice(0, 50)
    .filter((e) => e && EL_TYPES.has(e.type))
    .map((e) => {
      const el = { type: e.type, x: num(e.x, 0, 1, 0.5), y: num(e.y, 0, 1, 0.5), rotation: num(e.rotation, -360, 360, 0) };
      if (typeof e.id === 'string') el.id = e.id.slice(0, 40);
      if (e.type === 'post') el.width = num(e.width, 0.2, 1, 0.72);
      if (e.type === 'mention') el.scale = num(e.scale, 0.6, 2.2, 1);
      if (e.type === 'text') {
        el.text = String(e.text || '').slice(0, 200);
        el.size = num(e.size, 8, 200, 56);
        el.color = typeof e.color === 'string' ? e.color.slice(0, 32) : '#ffffff';
        el.bold = e.bold !== false;
        el.align = TEXT_ALIGN.has(e.align) ? e.align : 'center';
      }
      return el;
    });

  return { version: 1, background, elements };
}

// A story background asset that's no longer referenced should be deleted.
function unlinkOrphanStoryBackground(oldLayout, newLayout) {
  const oldUrl = oldLayout?.background?.type === 'image' ? oldLayout.background.url : null;
  const newUrl = newLayout?.background?.type === 'image' ? newLayout.background.url : null;
  if (oldUrl && oldUrl !== newUrl && oldUrl.startsWith('/uploads/stories/assets/')) {
    unlinkMediaFiles([oldUrl]);
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
    const detail = graphErrorMessage(err);
    console.error('Place search failed:', err.response?.data || err.message);
    // Surface Meta's actual reason — most often a missing capability
    // ("Page Public Content Access") or an invalid/expired token — so the
    // user can act on it instead of seeing an unexplained empty result box.
    res.status(502).json({ error: `Location search failed: ${detail}` });
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

// POST /api/posts/:id/story-asset — upload a custom background image for the
// story editor. Returns the public URL to drop into the layout's background.
router.post('/:id/story-asset', auth, runUpload(uploadStoryAsset.single('asset')), async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) {
      // Multer already wrote the file — don't leave it orphaned on a bad request.
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Post not found' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    res.json({ url: `/uploads/stories/assets/${req.file.filename}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload story background' });
  }
});

// PUT /api/posts/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { caption, postToStory, location, locationId, storyLayout, thumbOffset, scheduledFor } = req.body;
    const data = {};
    if (caption !== undefined) data.caption = caption;
    if (postToStory !== undefined) data.postToStory = postToStory;
    if (location !== undefined) data.location = location;
    if (locationId !== undefined) data.locationId = locationId;
    if (storyLayout !== undefined) {
      try {
        data.storyLayout = sanitizeStoryLayout(storyLayout); // null clears the custom story
        unlinkOrphanStoryBackground(post.storyLayout, data.storyLayout);
      } catch {
        return res.status(400).json({ error: 'Invalid story layout' });
      }
    }
    if (thumbOffset !== undefined) data.thumbOffset = thumbOffset === '' ? null : Number(thumbOffset);
    if (scheduledFor !== undefined) {
      if (['posting', 'posted'].includes(post.status)) {
        return res.status(400).json({ error: 'Cannot reschedule a slot that is posting or already posted' });
      }
      const when = new Date(scheduledFor);
      if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date/time' });
      data.scheduledFor = when;
    }

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
