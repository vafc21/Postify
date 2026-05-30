const axios = require('axios');
const prisma = require('../utils/prisma');
const { publishPost } = require('./meta');
const { generateSlots } = require('./slotGenerator');

const POLL_INTERVAL_MS = 60 * 1000;
const MAX_PUBLISH_ATTEMPTS = 3;

function isWithinPostingWindow(timezone) {
  const tz = timezone || process.env.POSTING_TIMEZONE || 'America/New_York';
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()),
    10
  );
  return hour >= 8 && hour < 20;
}

async function sendWebhook(webhookUrl, event, post, client, extra = {}) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, {
      event,
      message: event === 'post_published'
        ? `Done - ${client.name}`
        : `Failed - ${client.name}`,
      clientName: client.name,
      businessName: client.businessName,
      postId: post.id,
      scheduledFor: post.scheduledFor,
      platforms: [
        post.instagramResult && !post.instagramResult.error ? 'Instagram' : null,
        post.facebookResult && !post.facebookResult.error ? 'Facebook' : null,
      ].filter(Boolean),
      timestamp: new Date().toISOString(),
      ...extra,
    }, { timeout: 5000 });
  } catch (err) {
    console.warn(`Worker: webhook notification failed: ${err.message}`);
  }
}

async function processPost(post) {
  try {
    const claimed = await prisma.scheduledPost.updateMany({
      where: { id: post.id, status: 'uploaded' },
      data: { status: 'posting' },
    });
    if (claimed.count === 0) return;

    const [tokens, user] = await Promise.all([
      prisma.clientToken.findMany({ where: { clientId: post.clientId } }),
      prisma.user.findUnique({
        where: { id: post.client.userId },
        select: { metaAppId: true, metaAppSecret: true, notificationWebhookUrl: true, timezone: true },
      }),
    ]);

    if (!isWithinPostingWindow(user?.timezone)) {
      // Outside posting window — release the claim so it can be picked up later
      await prisma.scheduledPost.updateMany({
        where: { id: post.id, status: 'posting' },
        data: { status: 'uploaded' },
      });
      return;
    }

    const serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
    const { instagramResult, facebookResult } = await publishPost(post, tokens, user, serverUrl);

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: 'posted',
        instagramResult: instagramResult || undefined,
        facebookResult: facebookResult || undefined,
      },
    });

    await sendWebhook(user.notificationWebhookUrl, 'post_published', updated, post.client);
  } catch (err) {
    console.error(`Worker: failed to post ${post.id}:`, err.message);
    const nextAttempts = (post.attempts || 0) + 1;
    const giveUp = nextAttempts >= MAX_PUBLISH_ATTEMPTS;
    const failed = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: giveUp ? 'failed' : 'uploaded',
        attempts: nextAttempts,
        instagramResult: { error: err.message, attempt: nextAttempts },
      },
    }).catch(() => null);

    if (giveUp && failed) {
      const user = await prisma.user.findUnique({
        where: { id: post.client.userId },
        select: { notificationWebhookUrl: true },
      });
      await sendWebhook(user?.notificationWebhookUrl, 'post_failed', failed, post.client, { error: err.message });
    }
  }
}

async function publishDuePosts() {
  const duePosts = await prisma.scheduledPost.findMany({
    where: {
      status: 'uploaded',
      scheduledFor: { lte: new Date() },
    },
    include: {
      client: { select: { userId: true, name: true, businessName: true } },
    },
  });

  if (duePosts.length > 0) {
    console.log(`Worker: publishing ${duePosts.length} due post(s)`);
  }

  await Promise.allSettled(duePosts.map(processPost));
}

async function topUpSlots() {
  // Pull the user's timezone alongside each campaign so generated slot times
  // match what the admin saw when creating the campaign, not server-local UTC.
  const campaigns = await prisma.campaign.findMany({
    where: { isActive: true },
    include: { client: { include: { user: { select: { timezone: true } } } } },
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
      const tz = campaign.client?.user?.timezone;
      const slots = generateSlots(campaign, new Date(), 30, { timezone: tz });
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

async function recoverStuckPosts() {
  // Anything left in "posting" after a restart didn't actually publish — return
  // it to "uploaded" so the next tick retries instead of marking it dead.
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stuck = await prisma.scheduledPost.updateMany({
    where: {
      status: 'posting',
      updatedAt: { lt: fiveMinutesAgo },
    },
    data: { status: 'uploaded' },
  });
  if (stuck.count > 0) {
    console.log(`Worker: recovered ${stuck.count} stuck post(s) from previous session — requeued`);
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
  recoverStuckPosts().then(() => tick());
  return setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startWorker, processPost, publishDuePosts, topUpSlots, recoverStuckPosts };
