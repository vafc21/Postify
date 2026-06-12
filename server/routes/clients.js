const express = require('express');
const multer = require('multer');
const { MulterError } = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { decrypt, readToken } = require('../utils/encryption');
const { getIgProfile } = require('../services/meta');
const storrito = require('../services/storrito');

const router = express.Router();

// Coerce the "uses stories" flag from multipart/form-data, where it arrives as a
// string ("true"/"false"). Anything truthy-looking enables it.
function parseUsesStories(v) {
  if (v === undefined) return undefined;
  return v === true || v === 'true' || v === '1' || v === 'on';
}

function runUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  };
}

// Ensure logo upload dir exists
const logoDir = path.join(__dirname, '../uploads/logos');
fs.mkdirSync(logoDir, { recursive: true });

// SVG is intentionally excluded: logos are served from /uploads on the app's own
// origin with no sanitization, so an SVG with an embedded <script> would run as
// stored XSS when opened directly. Post media and story assets already exclude
// SVG for the same reason.
const LOGO_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const logoStorage = multer.diskStorage({
  destination: logoDir,
  filename: (req, file, cb) => {
    const ext = LOGO_EXTENSIONS[file.mimetype];
    cb(null, `${uuidv4()}${ext}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (LOGO_EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPG, PNG, GIF, or WebP.`));
  },
});

// GET /api/clients
router.get('/', auth, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { userId: req.userId },
      include: {
        tokens: { select: { platform: true } },
        _count: { select: { campaigns: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

// POST /api/clients
router.post('/', auth, runUpload(uploadLogo.single('logo')), async (req, res) => {
  try {
    const { name, businessName, website, industry, contactName, contactEmail, notes, usesStories } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name is required' });

    const logoUrl = req.file ? `/uploads/logos/${req.file.filename}` : null;

    const client = await prisma.client.create({
      data: {
        userId: req.userId,
        name,
        businessName: businessName || null,
        logoUrl,
        website: website || null,
        industry: industry || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        notes: notes || null,
        usesStories: parseUsesStories(usesStories) || false,
      },
    });
    res.status(201).json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// GET /api/clients/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: {
        tokens: { select: { platform: true, pageId: true, instagramAccountId: true, expiresAt: true } },
        campaigns: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load client' });
  }
});

// PUT /api/clients/:id
router.put('/:id', auth, runUpload(uploadLogo.single('logo')), async (req, res) => {
  try {
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const { name, businessName, website, industry, contactName, contactEmail, notes, usesStories } = req.body;
    const data = {};
    if (name) data.name = name;
    if (businessName !== undefined) data.businessName = businessName;
    if (website !== undefined) data.website = website;
    if (industry !== undefined) data.industry = industry;
    if (contactName !== undefined) data.contactName = contactName;
    if (contactEmail !== undefined) data.contactEmail = contactEmail;
    if (notes !== undefined) data.notes = notes;
    if (usesStories !== undefined) data.usesStories = parseUsesStories(usesStories);
    if (req.file) data.logoUrl = `/uploads/logos/${req.file.filename}`;

    // Ownership verified by findFirst above; TOCTOU window is acceptable here
    const client = await prisma.client.update({ where: { id: req.params.id }, data });
    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    // Ownership verified by findFirst above; TOCTOU window is acceptable here
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// POST /api/clients/:id/storrito/sync — the one-time per-client "Connect for
// Stories" verification. Resolves the client's IG handle and checks whether that
// account is connected inside the operator's Storrito account. On a match it
// records the handle (storrito then publishes that client's sticker stories);
// otherwise it returns the handle to connect in Storrito and try again.
//
// Body (optional): { instagramUsername } to set the match manually when the IG
// handle can't be auto-resolved via the Graph API.
router.post('/:id/storrito/sync', auth, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { tokens: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { storritoApiToken: true, storritoApiBase: true, metaAppSecret: true },
    });
    if (!storrito.isConfigured(user)) {
      return res.status(400).json({ code: 'storrito_not_configured', error: 'Add your Storrito API token and base URL in Settings first.' });
    }

    // Figure out which IG handle to match: an explicit override, else resolve it
    // from the client's connected Instagram account via the Graph API.
    let handle = (req.body?.instagramUsername || '').trim().replace(/^@/, '');
    if (!handle) {
      const igToken = client.tokens.find((t) => t.platform === 'instagram');
      if (!igToken || !igToken.instagramAccountId) {
        return res.status(400).json({ error: 'Connect this client\'s Instagram account first, or pass the handle manually.' });
      }
      const profile = await getIgProfile(igToken.instagramAccountId, readToken(igToken.accessToken), decrypt(user.metaAppSecret));
      handle = (profile?.username || '').replace(/^@/, '');
      if (!handle) {
        return res.status(400).json({ error: 'Could not resolve this client\'s Instagram handle. Pass it manually to link Storrito.' });
      }
    }

    let connected;
    try {
      connected = await storrito.listInstagramUsers(user);
    } catch (err) {
      console.error('Storrito list-instagram-users failed:', err.message);
      return res.status(502).json({ error: 'Could not reach Storrito to verify the connection. Check your API credentials.' });
    }

    const match = connected.find((u) => u.instagramUsername.toLowerCase() === handle.toLowerCase());
    if (!match) {
      return res.json({
        connected: false,
        instagramUsername: handle,
        message: `@${handle} isn't connected in Storrito yet. Connect it in your Storrito account, then verify again.`,
      });
    }

    await prisma.client.update({ where: { id: client.id }, data: { storritoUsername: match.instagramUsername, usesStories: true } });
    res.json({ connected: true, instagramUsername: match.instagramUsername });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sync Storrito connection' });
  }
});

// DELETE /api/clients/:id/storrito — unlink the Storrito Stories connection
// (the IG account stays connected inside Storrito; Postify just stops routing to it).
router.delete('/:id/storrito', auth, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await prisma.client.update({ where: { id: client.id }, data: { storritoUsername: null } });
    res.json({ message: 'Storrito connection removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove Storrito connection' });
  }
});

const { generateSlots, endOfDayInTz } = require('../services/slotGenerator');
const { getTemplate } = require('../services/templates');

// POST /api/clients/:id/campaigns
router.post('/:id/campaigns', auth, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { timezone: true } });

    let {
      name, description, type, presetTemplate,
      frequency, timesPerCycle, scheduleConfig,
      postToInstagram, postToFacebook, postToStory,
      endDate,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (!frequency) return res.status(400).json({ error: 'Frequency is required' });
    if (!scheduleConfig) return res.status(400).json({ error: 'Schedule config is required' });

    // Resolve to end-of-day in the user's timezone so the chosen date is
    // fully included (e.g. picking June 15 in ET runs through 23:59 ET, not
    // 19:59 ET as UTC midnight would imply).
    const oneMonthOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const resolvedEndDate = endOfDayInTz(endDate || oneMonthOut, user?.timezone);
    if (!resolvedEndDate || isNaN(resolvedEndDate.getTime())) {
      return res.status(400).json({ error: 'Invalid end date' });
    }

    if (type === 'preset' && presetTemplate) {
      const tmpl = getTemplate(presetTemplate);
      if (tmpl) {
        frequency = frequency || tmpl.frequency;
        timesPerCycle = timesPerCycle || tmpl.timesPerCycle;
        scheduleConfig = scheduleConfig || tmpl.scheduleConfig;
      }
    }

    const campaign = await prisma.campaign.create({
      data: {
        clientId: client.id,
        name,
        description: description || null,
        type: type || 'custom',
        presetTemplate: presetTemplate || null,
        frequency,
        timesPerCycle: timesPerCycle || 1,
        scheduleConfig,
        postToInstagram: postToInstagram ?? true,
        postToFacebook: postToFacebook ?? true,
        postToStory: postToStory ?? true,
        endDate: resolvedEndDate,
      },
    });

    const daysUntilEnd = Math.ceil((resolvedEndDate - new Date()) / (24 * 60 * 60 * 1000));
    const generationWindow = Math.max(1, Math.min(60, daysUntilEnd));
    const slots = generateSlots(campaign, new Date(), generationWindow, { timezone: user?.timezone });
    if (slots.length > 0) {
      await prisma.scheduledPost.createMany({ data: slots });
    }

    res.status(201).json({ ...campaign, slotsCreated: slots.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// GET /api/clients/:id/campaigns
router.get('/:id/campaigns', auth, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const campaigns = await prisma.campaign.findMany({
      where: { clientId: req.params.id },
      include: {
        _count: { select: { scheduledPosts: true } },
        // "Slots have media" should reflect slots that actually have media,
        // regardless of status — filtering by status:'uploaded' made the bar
        // regress to zero as posts moved to 'posted'.
        scheduledPosts: {
          where: { mediaUrls: { isEmpty: false } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load campaigns' });
  }
});

module.exports = router;
