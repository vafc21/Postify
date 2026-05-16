const prisma = require('../utils/prisma');
const { publishPost } = require('./meta');
const { generateSlots } = require('./slotGenerator');

const POLL_INTERVAL_MS = 60 * 1000;

async function processPost(post) {
  try {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'posting' },
    });

    const [tokens, user] = await Promise.all([
      prisma.clientToken.findMany({ where: { clientId: post.clientId } }),
      prisma.user.findUnique({ where: { id: post.client.userId }, select: { metaAppId: true, metaAppSecret: true } }),
    ]);

    const serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
    const { instagramResult, facebookResult } = await publishPost(post, tokens, user, serverUrl);

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: 'posted',
        instagramResult: instagramResult || undefined,
        facebookResult: facebookResult || undefined,
      },
    });
  } catch (err) {
    console.error(`Worker: failed to post ${post.id}:`, err.message);
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: 'failed',
        instagramResult: { error: err.message },
      },
    }).catch(() => {});
  }
}

async function publishDuePosts() {
  const duePosts = await prisma.scheduledPost.findMany({
    where: {
      status: 'uploaded',
      scheduledFor: { lte: new Date() },
    },
    include: { client: { select: { userId: true } } },
  });

  if (duePosts.length > 0) {
    console.log(`Worker: publishing ${duePosts.length} due post(s)`);
  }

  await Promise.allSettled(duePosts.map(processPost));
}

async function topUpSlots() {
  const campaigns = await prisma.campaign.findMany({
    where: { isActive: true },
  });

  for (const campaign of campaigns) {
    const futureCount = await prisma.scheduledPost.count({
      where: {
        campaignId: campaign.id,
        scheduledFor: { gte: new Date() },
        status: 'pending',
      },
    });

    if (futureCount < 14) {
      const slots = generateSlots(campaign, new Date(), 30);
      if (slots.length > 0) {
        const existingTimes = await prisma.scheduledPost.findMany({
          where: { campaignId: campaign.id, scheduledFor: { gte: new Date() } },
          select: { scheduledFor: true },
        });
        const existingSet = new Set(existingTimes.map(s => s.scheduledFor.toISOString()));
        const newSlots = slots.filter(s => !existingSet.has(new Date(s.scheduledFor).toISOString()));
        if (newSlots.length > 0) {
          await prisma.scheduledPost.createMany({ data: newSlots });
        }
      }
    }
  }
}

function startWorker() {
  console.log('Worker: started, polling every 60s');
  const tick = async () => {
    try {
      await publishDuePosts();
      await topUpSlots();
    } catch (err) {
      console.error('Worker tick error:', err);
    }
  };
  tick();
  return setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startWorker, processPost, publishDuePosts, topUpSlots };
