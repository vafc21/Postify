const express = require('express');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { generateSlots } = require('../services/slotGenerator');
const { getTemplate, TEMPLATES } = require('../services/templates');

const router = express.Router();

// GET /api/campaigns/templates
router.get('/templates', auth, (req, res) => {
  res.json(TEMPLATES);
});

// GET /api/campaigns/:id/posts
router.get('/:id/posts', auth, async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, client: { userId: req.userId } },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const posts = await prisma.scheduledPost.findMany({
      where: { campaignId: req.params.id },
      orderBy: { scheduledFor: 'asc' },
    });
    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load campaign posts' });
  }
});

// GET /api/campaigns/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, client: { userId: req.userId } },
      include: { scheduledPosts: { orderBy: { scheduledFor: 'asc' } } },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load campaign' });
  }
});

// PUT /api/campaigns/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, client: { userId: req.userId } },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { name, description, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;

    // Ownership verified by findFirst above via client.userId; TOCTOU window is acceptable here
    const updated = await prisma.campaign.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, client: { userId: req.userId } },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    // Ownership verified by findFirst above via client.userId; TOCTOU window is acceptable here
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

module.exports = router;
