const fs = require('fs');
const path = require('path');
const axios = require('axios');
const prisma = require('../utils/prisma');
const { publishPost } = require('./meta');
const { generateSlots } = require('./slotGenerator');

const POLL_INTERVAL_MS = 60 * 1000;
const MAX_PUBLISH_ATTEMPTS = 3;
// How long a post may sit in "posting" with no progress before it's considered
// orphaned and requeued. Generous enough to never interrupt a healthy publish.
const STUCK_GRACE_MS = 10 * 60 * 1000;

// Posts publish at their exact scheduled time by default. Quiet hours are
// opt-in: set POSTING_WINDOW_START and POSTING_WINDOW_END (24h, e.g. 8 and 20)
// to only allow publishing within that window in the user's timezone.
function isWithinPostingWindow(timezone) {
  const start = process.env.POSTING_WINDOW_START;
  const end = process.env.POSTING_WINDOW_END;
  if (start === undefined || end === undefined) return true;
  const tz = timezone || process.env.POSTING_TIMEZONE || 'America/New_York';
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: 'numeric' }).format(new Date()),
    10
  );
  return hour >= Number(start) && hour < Number(end);
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
  // Tracks whatever publishPost returned, so the catch block below can tell a
  // post-publish failure (don't wipe the live-post IDs / don't republish) from a
  // pre-publish one.
  let lastResults = null;
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
    const { instagramResult, facebookResult } = await publishPost(post, tokens, user, serverUrl, {
      // Persist each platform's result the instant it's known. If the process
      // dies (or the final status write below fails) AFTER a platform went live,
      // the saved result lets the retry skip that platform instead of posting a
      // duplicate.
      onResult: async (platform, result) => {
        try {
          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: platform === 'instagram'
              ? { instagramResult: result || undefined }
              : { facebookResult: result || undefined },
          });
        } catch (_) { /* best-effort — the final update is the source of truth */ }
      },
    });
    lastResults = { instagramResult, facebookResult };

    // A platform "succeeded" only if it was attempted and its feed post went through.
    const igOk = !!(instagramResult && !instagramResult.error && instagramResult.feed && !instagramResult.feed.error);
    const fbOk = !!(facebookResult && !facebookResult.error && facebookResult.feed && !facebookResult.feed.error);
    const attempted = (instagramResult ? 1 : 0) + (facebookResult ? 1 : 0);

    if (attempted === 0 || (!igOk && !fbOk)) {
      const reason = attempted === 0
        ? 'No connected Instagram or Facebook account for this client'
        : 'Publishing failed on all platforms';
      const nextAttempts = (post.attempts || 0) + 1;
      // No point retrying a client with no connected accounts
      const giveUp = nextAttempts >= MAX_PUBLISH_ATTEMPTS || attempted === 0;
      const failed = await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: giveUp ? 'failed' : 'uploaded',
          attempts: nextAttempts,
          instagramResult: instagramResult || undefined,
          facebookResult: facebookResult || undefined,
        },
      });
      console.error(`Worker: post ${post.id} ${giveUp ? 'failed' : 'will retry'} — ${reason}`);
      if (giveUp) {
        await sendWebhook(user.notificationWebhookUrl, 'post_failed', failed, post.client, { error: reason });
      }
      return;
    }

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
    // The post — or its parent campaign/client — can be deleted while we're
    // mid-publish; the cascade removes the row out from under us and Prisma
    // throws P2025. There's nothing left to update, so skip cleanly instead of
    // logging a failure and burning a retry attempt.
    if (err.code === 'P2025') {
      console.log(`Worker: post ${post.id} was deleted during publish — skipping`);
      return;
    }
    console.error(`Worker: failed to post ${post.id}:`, err.message);
    const nextAttempts = (post.attempts || 0) + 1;
    const giveUp = nextAttempts >= MAX_PUBLISH_ATTEMPTS;
    // Never overwrite a platform result that already went live (it was persisted
    // incrementally, or is on the incoming record) — clobbering it with an error
    // would both hide the live post and let the retry republish it.
    const hadSuccess =
      lastResults?.instagramResult?.feed?.mediaId ||
      lastResults?.facebookResult?.feed?.postId ||
      post.instagramResult?.feed?.mediaId ||
      post.facebookResult?.feed?.postId;
    const data = { status: giveUp ? 'failed' : 'uploaded', attempts: nextAttempts };
    if (!hadSuccess) data.instagramResult = { error: err.message, attempt: nextAttempts };
    const failed = await prisma.scheduledPost.update({
      where: { id: post.id },
      data,
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

  // Publish one post at a time. Running every due post concurrently meant
  // several videos could be served to Meta — and several ffmpeg story-card
  // encodes could run — at once, and that combined footprint is what
  // OOM-killed the 512MB instance. processPost swallows its own errors, so a
  // single failing post never stalls the rest.
  for (const post of duePosts) {
    await processPost(post);
  }
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
  // A post left in "posting" with no recent progress is orphaned — e.g. a
  // crash/redeploy mid-publish. Requeue it so it retries. This runs EVERY tick
  // (not just at startup), because a transient stall mid-session would otherwise
  // strand the post in "posting" forever. The grace window must exceed the
  // longest healthy publish (IG video wait + FB video story + composite ≈ a few
  // minutes); since processPost persists each platform result as it lands,
  // `updatedAt` keeps advancing for a post that's genuinely making progress, so
  // a 10-minute idle window only ever catches truly stuck posts. Requeuing is
  // safe even if a platform already published — publishPost skips done platforms.
  const cutoff = new Date(Date.now() - STUCK_GRACE_MS);
  const stuck = await prisma.scheduledPost.updateMany({
    where: {
      status: 'posting',
      updatedAt: { lt: cutoff },
    },
    data: { status: 'uploaded' },
  });
  if (stuck.count > 0) {
    console.log(`Worker: recovered ${stuck.count} stuck post(s) — requeued`);
  }
}

// Derived story files (rendered 9:16 PNGs and composited MP4s) accumulate in
// uploads/stories with one set per publish attempt and are never referenced
// again once Meta has fetched them during publishing. Prune ones older than 48h
// so the directory doesn't grow without bound. The assets/ subdir holds
// user-uploaded story backgrounds (referenced by saved layouts) and is skipped.
function cleanupDerivedStories() {
  const dir = path.join(__dirname, '..', 'uploads', 'stories');
  const maxAgeMs = 48 * 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return; // directory not created yet — nothing to clean
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile()) continue; // skip the assets/ subdir
    const abs = path.join(dir, entry.name);
    try {
      if (now - fs.statSync(abs).mtimeMs > maxAgeMs) fs.unlinkSync(abs);
    } catch (_) { /* best-effort */ }
  }
}

function startWorker() {
  console.log('Worker: started, polling every 60s');
  const tick = async () => {
    try {
      await recoverStuckPosts();
      await publishDuePosts();
      await topUpSlots();
      cleanupDerivedStories();
    } catch (err) {
      console.error('Worker tick error:', err);
    } finally {
      // Footprint each tick so the next OOM leaves a paper trail. rss ≈ heapUsed
      // points at JS-heap pressure (the --max-old-space-size cap helps); rss far
      // above heapUsed points at native pressure (Prisma / image libs), where
      // only a larger instance helps.
      const m = process.memoryUsage();
      const mb = (n) => Math.round(n / 1024 / 1024);
      console.log(`Worker: mem rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB`);
    }
  };
  tick();
  return setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startWorker, processPost, publishDuePosts, topUpSlots, recoverStuckPosts, cleanupDerivedStories };
