const express = require('express');
const prisma = require('../utils/prisma');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/posts — get current user's posts (paginated)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          description: true,
          platforms: true,
          status: true,
          createdAt: true,
          youtubeResult: true,
          instagramResult: true,
          tiktokResult: true,
        },
      }),
      prisma.post.count({ where: { userId: req.userId } }),
    ]);

    res.json({
      posts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Posts GET error:', err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// GET /api/posts/:id — get a specific post
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await prisma.post.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });

    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

module.exports = router;
