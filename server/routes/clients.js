const express = require('express');
const multer = require('multer');
const { MulterError } = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

function runUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err) return next(err);
      next();
    });
  };
}

// Ensure logo upload dir exists
const logoDir = path.join(__dirname, '../uploads/logos');
fs.mkdirSync(logoDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: logoDir,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const uploadLogo = multer({ storage: logoStorage, limits: { fileSize: 2 * 1024 * 1024 } });

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
    const { name, businessName, website, industry, contactName, contactEmail, notes } = req.body;
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

    const { name, businessName, website, industry, contactName, contactEmail, notes } = req.body;
    const data = {};
    if (name) data.name = name;
    if (businessName !== undefined) data.businessName = businessName;
    if (website !== undefined) data.website = website;
    if (industry !== undefined) data.industry = industry;
    if (contactName !== undefined) data.contactName = contactName;
    if (contactEmail !== undefined) data.contactEmail = contactEmail;
    if (notes !== undefined) data.notes = notes;
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

const { generateSlots } = require('../services/slotGenerator');
const { getTemplate } = require('../services/templates');

// POST /api/clients/:id/campaigns
router.post('/:id/campaigns', auth, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    let {
      name, description, type, presetTemplate,
      frequency, timesPerCycle, scheduleConfig,
      postToInstagram, postToFacebook, postToStory,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (!frequency) return res.status(400).json({ error: 'Frequency is required' });
    if (!scheduleConfig) return res.status(400).json({ error: 'Schedule config is required' });

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
      },
    });

    const slots = generateSlots(campaign, new Date(), 60);
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
        scheduledPosts: {
          where: { status: 'uploaded' },
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
