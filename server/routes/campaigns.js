const express = require('express');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { generateSlots, endOfDayInTz } = require('../services/slotGenerator');
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

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { timezone: true },
    });

    const { name, description, isActive, endDate } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;
    if (endDate !== undefined) {
      if (endDate === null) {
        data.endDate = null;
      } else {
        const resolved = endOfDayInTz(endDate, user?.timezone);
        if (!resolved || isNaN(resolved.getTime())) {
          return res.status(400).json({ error: 'Invalid end date' });
        }
        data.endDate = resolved;
      }
    }

    const updated = await prisma.campaign.update({ where: { id: req.params.id }, data });

    // End-date changes affect existing slots in two directions:
    //   - shorter: drop pending slots that fall past the new cutoff
    //   - longer:  fill in new slots between the last existing slot and the new cutoff
    if (data.endDate) {
      await prisma.scheduledPost.deleteMany({
        where: {
          campaignId: req.params.id,
          status: 'pending',
          scheduledFor: { gt: data.endDate },
        },
      });

      const oldEnd = campaign.endDate ? new Date(campaign.endDate) : null;
      const newEnd = new Date(data.endDate);
      const extended = !oldEnd || newEnd > oldEnd;
      if (extended) {
        const now = new Date();
        const daysUntilEnd = Math.ceil((newEnd - now) / 86400000);
        const window = Math.max(1, Math.min(60, daysUntilEnd));
        const slots = generateSlots(updated, now, window, { timezone: user?.timezone });
        if (slots.length > 0) {
          const existing = await prisma.scheduledPost.findMany({
            where: { campaignId: req.params.id, scheduledFor: { gte: now } },
            select: { scheduledFor: true },
          });
          const taken = new Set(existing.map(s => s.scheduledFor.toISOString()));
          const newSlots = slots.filter(s => !taken.has(new Date(s.scheduledFor).toISOString()));
          if (newSlots.length > 0) {
            await prisma.scheduledPost.createMany({ data: newSlots });
          }
        }
      }
    }

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
