# Postify Phase 2: Meta API Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Meta OAuth flow (connect client Instagram/Facebook accounts), a Meta Graph API publishing service, and the background worker that polls the DB every 60s and publishes due posts.

**Architecture:** OAuth state stored in a signed JWT passed through Meta's `state` param. Tokens stored in `client_tokens`. Worker runs `setInterval` in the same Node process. Media served via the existing `/uploads` static route for Meta's container API.

**Tech Stack:** Node.js, Express, axios, Meta Graph API v18.0, Prisma

**Prerequisite:** Phase 1 complete. User must have a Meta Developer App with `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` permissions and the OAuth redirect URI set to `http://localhost:5000/api/oauth/callback` (or production URL).

---

## File Map

**Create:**
- `server/routes/oauth.js`
- `server/services/meta.js`
- `server/services/worker.js`
- `server/tests/worker.test.js`

**Modify:**
- `server/index.js` (register oauth route, start worker)

---

## Task 1: Meta Publishing Service

**Files:**
- Create: `server/services/meta.js`

- [ ] **Step 1: Create `server/services/meta.js`**

```js
const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v18.0';

/**
 * Publish a post to Instagram and/or Facebook feed + optionally story.
 * @param {object} post - scheduledPost record
 * @param {object} client - client record (for token lookup)
 * @param {object[]} tokens - client_tokens records for this client
 * @param {object} appCreds - { metaAppId, metaAppSecret }
 * @param {string} serverUrl - base URL of this server (for media URLs)
 * @returns {{ instagramResult, facebookResult }}
 */
async function publishPost(post, tokens, appCreds, serverUrl) {
  const results = { instagramResult: null, facebookResult: null };

  const igToken = tokens.find(t => t.platform === 'instagram');
  const fbToken = tokens.find(t => t.platform === 'facebook');

  if (igToken && igToken.instagramAccountId) {
    try {
      results.instagramResult = await publishToInstagram({
        igUserId: igToken.instagramAccountId,
        accessToken: igToken.accessToken,
        post,
        serverUrl,
      });
    } catch (err) {
      results.instagramResult = { error: err.response?.data || err.message };
    }
  }

  if (fbToken && fbToken.pageId) {
    try {
      results.facebookResult = await publishToFacebook({
        pageId: fbToken.pageId,
        accessToken: fbToken.accessToken,
        post,
        serverUrl,
      });
    } catch (err) {
      results.facebookResult = { error: err.response?.data || err.message };
    }
  }

  return results;
}

async function publishToInstagram({ igUserId, accessToken, post, serverUrl }) {
  const { mediaType, mediaUrls, caption, postToStory } = post;
  const feedResult = await publishIgFeed({ igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl });

  let storyResult = null;
  if (postToStory) {
    try {
      storyResult = await publishIgStory({ igUserId, accessToken, mediaType, mediaUrls, serverUrl });
    } catch (err) {
      storyResult = { error: err.response?.data || err.message };
    }
  }

  return { feed: feedResult, story: storyResult };
}

async function publishIgFeed({ igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl }) {
  let creationId;

  if (mediaType === 'carousel') {
    // Step 1: Create child containers
    const childIds = await Promise.all(
      mediaUrls.map(url =>
        axios.post(`${GRAPH}/${igUserId}/media`, {
          image_url: `${serverUrl}${url}`,
          is_carousel_item: true,
          access_token: accessToken,
        }).then(r => r.data.id)
      )
    );

    // Step 2: Create carousel container
    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    });
    creationId = data.id;
  } else if (mediaType === 'video') {
    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, {
      media_type: 'REELS',
      video_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    });
    creationId = data.id;
    // Wait for video to process
    await waitForContainer(creationId, accessToken);
  } else {
    // photo
    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, {
      image_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    });
    creationId = data.id;
  }

  // Publish the container
  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
  return { mediaId: data.id, creationId };
}

async function publishIgStory({ igUserId, accessToken, mediaType, mediaUrls, serverUrl }) {
  const isVideo = mediaType === 'video';
  const params = isVideo
    ? { media_type: 'VIDEO', video_url: `${serverUrl}${mediaUrls[0]}` }
    : { image_url: `${serverUrl}${mediaUrls[0]}` };

  const { data: container } = await axios.post(`${GRAPH}/${igUserId}/media`, {
    ...params,
    media_type: isVideo ? 'VIDEO' : undefined,
    is_story: !isVideo ? true : undefined,
    access_token: accessToken,
  });

  if (isVideo) await waitForContainer(container.id, accessToken);

  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return { mediaId: data.id };
}

async function publishToFacebook({ pageId, accessToken, post, serverUrl }) {
  const { mediaType, mediaUrls, caption, postToStory } = post;
  let feedResult;

  if (mediaType === 'video') {
    const { data } = await axios.post(`${GRAPH}/${pageId}/videos`, {
      file_url: `${serverUrl}${mediaUrls[0]}`,
      description: caption,
      access_token: accessToken,
    });
    feedResult = { videoId: data.id };
  } else if (mediaType === 'carousel' || mediaType === 'photo') {
    // For multiple photos, attach each as unpublished then publish together
    if (mediaUrls.length > 1) {
      const photoIds = await Promise.all(
        mediaUrls.map(url =>
          axios.post(`${GRAPH}/${pageId}/photos`, {
            url: `${serverUrl}${url}`,
            published: false,
            access_token: accessToken,
          }).then(r => ({ media_fbid: r.data.id }))
        )
      );
      const { data } = await axios.post(`${GRAPH}/${pageId}/feed`, {
        message: caption,
        attached_media: photoIds,
        access_token: accessToken,
      });
      feedResult = { postId: data.id };
    } else {
      const { data } = await axios.post(`${GRAPH}/${pageId}/photos`, {
        url: `${serverUrl}${mediaUrls[0]}`,
        message: caption,
        access_token: accessToken,
      });
      feedResult = { photoId: data.id };
    }
  }

  return { feed: feedResult };
}

async function waitForContainer(containerId, accessToken, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${GRAPH}/${containerId}`, {
      params: { fields: 'status_code', access_token: accessToken },
    });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error('Media container processing failed');
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('Media container timed out');
}

/**
 * Exchange a short-lived token for a long-lived one.
 */
async function getLongLivedToken(shortToken, appId, appSecret) {
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
  });
  return data; // { access_token, token_type, expires_in }
}

/**
 * Get pages (and their IG accounts) accessible by a user token.
 */
async function getPagesAndIgAccounts(userToken) {
  const { data } = await axios.get(`${GRAPH}/me/accounts`, {
    params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account' },
  });
  return data.data || [];
}

/**
 * Delete a post from Instagram by media ID.
 */
async function deleteIgPost(mediaId, accessToken) {
  await axios.delete(`${GRAPH}/${mediaId}`, { params: { access_token: accessToken } });
}

/**
 * Delete a post from Facebook by post/photo ID.
 */
async function deleteFbPost(postId, accessToken) {
  await axios.delete(`${GRAPH}/${postId}`, { params: { access_token: accessToken } });
}

module.exports = {
  publishPost,
  getLongLivedToken,
  getPagesAndIgAccounts,
  deleteIgPost,
  deleteFbPost,
};
```

- [ ] **Step 2: Commit**

```bash
git add server/services/meta.js
git commit -m "feat: add Meta Graph API publishing service"
```

---

## Task 2: OAuth Route

**Files:**
- Create: `server/routes/oauth.js`

- [ ] **Step 1: Create `server/routes/oauth.js`**

```js
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { getLongLivedToken, getPagesAndIgAccounts } = require('../services/meta');

const router = express.Router();

const GRAPH_AUTH = 'https://www.facebook.com/v18.0/dialog/oauth';
const SCOPES = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';

// GET /api/clients/:clientId/connect/:platform
// Initiates Meta OAuth — called from client profile page
router.get('/clients/:clientId/connect/:platform', auth, async (req, res) => {
  try {
    const { clientId, platform } = req.params;
    if (!['instagram', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.metaAppId || !user?.metaAppSecret) {
      return res.status(400).json({ error: 'Set Meta App ID and Secret in Settings first' });
    }

    // Encode clientId + platform + userId in state param (signed JWT, 10min TTL)
    const state = jwt.sign(
      { clientId, platform, userId: req.userId },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    const redirectUri = `${process.env.SERVER_URL || 'http://localhost:5000'}/api/oauth/callback`;
    const url = `${GRAPH_AUTH}?client_id=${user.metaAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${SCOPES}&state=${state}&response_type=code`;

    res.json({ url }); // Frontend opens this URL in a popup or redirect
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

// GET /api/oauth/callback — Meta redirects here with ?code=...&state=...
router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

  if (oauthError) {
    return res.redirect(`${CLIENT_URL}/oauth-result?error=${encodeURIComponent(oauthError)}`);
  }

  try {
    // Verify state
    const { clientId, platform, userId } = jwt.verify(state, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.metaAppId || !user?.metaAppSecret) {
      return res.redirect(`${CLIENT_URL}/oauth-result?error=missing_app_credentials`);
    }

    const redirectUri = `${process.env.SERVER_URL || 'http://localhost:5000'}/api/oauth/callback`;

    // Exchange code for short-lived token
    const axios = require('axios');
    const { data: tokenData } = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: user.metaAppId,
        client_secret: user.metaAppSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    // Exchange for long-lived token
    const longLived = await getLongLivedToken(tokenData.access_token, user.metaAppId, user.metaAppSecret);
    const longToken = longLived.access_token;
    const expiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000)
      : null;

    // Get pages + IG accounts
    const pages = await getPagesAndIgAccounts(longToken);

    if (pages.length === 0) {
      return res.redirect(`${CLIENT_URL}/oauth-result?error=no_pages_found`);
    }

    // Use the first page (if multiple pages, could let user pick — out of scope for now)
    const page = pages[0];
    const igAccountId = page.instagram_business_account?.id || null;

    // For instagram platform, store IG account; for facebook store page token
    const tokenRecord = {
      clientId,
      platform,
      accessToken: platform === 'facebook' ? page.access_token : longToken,
      expiresAt,
      pageId: page.id,
      instagramAccountId: igAccountId,
    };

    await prisma.clientToken.upsert({
      where: { clientId_platform: { clientId, platform } },
      update: tokenRecord,
      create: tokenRecord,
    });

    res.redirect(`${CLIENT_URL}/oauth-result?success=true&clientId=${clientId}&platform=${platform}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/oauth-result?error=${encodeURIComponent(err.message)}`);
  }
});

// DELETE /api/clients/:clientId/tokens/:platform — disconnect
router.delete('/clients/:clientId/tokens/:platform', auth, async (req, res) => {
  try {
    const { clientId, platform } = req.params;
    const client = await prisma.client.findFirst({ where: { id: clientId, userId: req.userId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    await prisma.clientToken.deleteMany({ where: { clientId, platform } });
    res.json({ message: `${platform} disconnected` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register in `server/index.js`**

```js
const oauthRoutes = require('./routes/oauth');
app.use('/api/oauth', oauthRoutes); // handles /api/oauth/clients/:id/connect/:platform and /api/oauth/callback
```

- [ ] **Step 3: Add `SERVER_URL` to `server/.env`**

```
SERVER_URL=http://localhost:5000
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/oauth.js server/index.js
git commit -m "feat: add Meta OAuth flow for connecting client Instagram/Facebook"
```

---

## Task 3: Background Worker

**Files:**
- Create: `server/services/worker.js`
- Create: `server/tests/worker.test.js`

- [ ] **Step 1: Write failing tests for `server/tests/worker.test.js`**

```js
const { processPost } = require('../services/worker');

// Mock prisma
jest.mock('../utils/prisma', () => ({
  scheduledPost: {
    update: jest.fn(),
    findMany: jest.fn(),
  },
  clientToken: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
}));

// Mock meta service
jest.mock('../services/meta', () => ({
  publishPost: jest.fn(),
}));

const prisma = require('../utils/prisma');
const { publishPost } = require('../services/meta');

describe('processPost', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks post as posting then posted on success', async () => {
    const post = {
      id: 'post-1',
      clientId: 'client-1',
      status: 'uploaded',
      mediaType: 'photo',
      mediaUrls: ['/uploads/photos/test.jpg'],
      caption: 'Hello',
      postToStory: true,
      client: { userId: 'user-1' },
    };

    prisma.clientToken.findMany.mockResolvedValue([
      { platform: 'instagram', accessToken: 'tok', instagramAccountId: 'ig-123', pageId: null },
    ]);
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret' });
    prisma.scheduledPost.update.mockResolvedValue({});
    publishPost.mockResolvedValue({ instagramResult: { feed: { mediaId: 'ig-post-1' } }, facebookResult: null });

    await processPost(post);

    // Should mark as 'posting' first
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'posting' }) })
    );
    // Should mark as 'posted' after success
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'posted' }) })
    );
  });

  test('marks post as failed on Meta API error', async () => {
    const post = {
      id: 'post-1',
      clientId: 'client-1',
      status: 'uploaded',
      client: { userId: 'user-1' },
    };

    prisma.clientToken.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret' });
    prisma.scheduledPost.update.mockResolvedValue({});
    publishPost.mockRejectedValue(new Error('Meta API error'));

    await processPost(post);

    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd server && npx jest tests/worker.test.js
```
Expected: FAIL — `Cannot find module '../services/worker'`

- [ ] **Step 3: Create `server/services/worker.js`**

```js
const prisma = require('../utils/prisma');
const { publishPost } = require('./meta');
const { generateSlots } = require('./slotGenerator');

const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds

/**
 * Process a single due post: mark posting → call Meta → mark posted/failed.
 * Exported for testing.
 */
async function processPost(post) {
  try {
    // Mark as in-progress to prevent double-processing
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
    }).catch(() => {}); // don't throw if update also fails
  }
}

/**
 * Find and publish all due posts.
 */
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

/**
 * For each active campaign with fewer than 14 future slots, generate 30 more days.
 */
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
        // Avoid duplicating existing slots by checking scheduled_for
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
  tick(); // run immediately on start
  return setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startWorker, processPost, publishDuePosts, topUpSlots };
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd server && npx jest tests/worker.test.js
```
Expected: PASS — 2 tests pass

- [ ] **Step 5: Start worker in `server/index.js`**

Add at the bottom of `index.js`, after `app.listen(...)`:

```js
if (process.env.NODE_ENV !== 'test') {
  const { startWorker } = require('./services/worker');
  startWorker();
}
```

- [ ] **Step 6: Run all tests**

```bash
cd server && npx jest
```
Expected: all tests pass (slot generator + worker)

- [ ] **Step 7: Commit**

```bash
git add server/services/worker.js server/tests/worker.test.js server/index.js
git commit -m "feat: add background worker for scheduled publishing and slot top-up"
```

---

## Task 4: Wire Unpost to Meta API

**Files:**
- Modify: `server/routes/posts.js`

- [ ] **Step 1: Update the unpost route in `server/routes/posts.js`**

Replace the unpost route body with:

```js
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

    const { deleteIgPost, deleteFbPost } = require('../services/meta');
    const tokens = await prisma.clientToken.findMany({ where: { clientId: post.clientId } });
    const errors = [];

    const igToken = tokens.find(t => t.platform === 'instagram');
    if (igToken && post.instagramResult?.feed?.mediaId) {
      try {
        await deleteIgPost(post.instagramResult.feed.mediaId, igToken.accessToken);
      } catch (err) {
        errors.push(`Instagram: ${err.response?.data?.error?.message || err.message}`);
      }
    }

    const fbToken = tokens.find(t => t.platform === 'facebook');
    if (fbToken && post.facebookResult?.feed?.postId) {
      try {
        await deleteFbPost(post.facebookResult.feed.postId, fbToken.accessToken);
      } catch (err) {
        errors.push(`Facebook: ${err.response?.data?.error?.message || err.message}`);
      }
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
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/posts.js
git commit -m "feat: wire unpost route to Meta API deletion"
```

---

## Phase 2 Complete

Phase 2 delivers:
- ✅ Meta OAuth flow (connect client Instagram + Facebook via popup)
- ✅ Meta publishing service (photo, carousel, video, stories for IG + FB)
- ✅ Background worker (publishes due posts every 60s, tops up slots)
- ✅ Unpost wired to Meta API deletion
- ✅ Worker tested with mocks

**Next:** [Phase 3 — Frontend](./2026-05-15-phase3-frontend.md)
