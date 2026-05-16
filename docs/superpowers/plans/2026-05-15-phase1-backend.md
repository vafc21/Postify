# Postify Phase 1: Backend Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the server with a new Prisma schema, and implement all REST API routes for auth, settings, clients, campaigns, and scheduled posts.

**Architecture:** Express + Prisma + PostgreSQL. Cookie-based JWT auth (unchanged pattern). All old routes/services replaced except `middleware/authMiddleware.js`, `middleware/errorHandler.js`, and `utils/prisma.js` which are kept as-is.

**Tech Stack:** Node.js, Express, Prisma 5, PostgreSQL, bcryptjs, jsonwebtoken, multer, Jest, Supertest

---

## File Map

**Keep unchanged:**
- `server/middleware/authMiddleware.js`
- `server/middleware/errorHandler.js`
- `server/utils/prisma.js`

**Rebuild:**
- `server/prisma/schema.prisma`
- `server/index.js`
- `server/routes/auth.js` (add `name` field support)
- `server/routes/settings.js`
- `server/routes/clients.js`
- `server/routes/campaigns.js`
- `server/routes/posts.js`
- `server/services/slotGenerator.js`
- `server/services/templates.js`

**Delete (no longer needed):**
- `server/routes/upload.js`
- `server/routes/oauth.js` (rebuilt in Phase 2)
- `server/services/claudeService.js`
- `server/services/instagramService.js`
- `server/services/tiktokService.js`
- `server/services/transcriptionService.js`
- `server/services/youtubeService.js`
- `server/services/tokenRefresh.js`
- `server/services/encryption.js`

**Add:**
- `server/package.json` (add jest, supertest)
- `server/jest.config.js`
- `server/tests/slotGenerator.test.js`
- `server/tests/clients.test.js`
- `server/tests/campaigns.test.js`
- `server/tests/posts.test.js`

---

## Task 1: Add Test Infrastructure

**Files:**
- Modify: `server/package.json`
- Create: `server/jest.config.js`

- [ ] **Step 1: Install Jest and Supertest**

```bash
cd server && npm install --save-dev jest supertest
```

- [ ] **Step 2: Add test script to `server/package.json`**

Add to `"scripts"`:
```json
"test": "jest --runInBand --forceExit"
```

- [ ] **Step 3: Create `server/jest.config.js`**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
};
```

- [ ] **Step 4: Verify Jest is working**

```bash
cd server && npx jest --listTests
```
Expected: empty list (no tests yet)

---

## Task 2: Rebuild Prisma Schema

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Replace `server/prisma/schema.prisma` entirely**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String    @map("password_hash")
  metaAppId     String?   @map("meta_app_id")
  metaAppSecret String?   @map("meta_app_secret")
  theme         String    @default("dark")
  createdAt     DateTime  @default(now()) @map("created_at")

  clients Client[]

  @@map("users")
}

model Client {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  name         String
  businessName String?  @map("business_name")
  logoUrl      String?  @map("logo_url")
  website      String?
  industry     String?
  contactName  String?  @map("contact_name")
  contactEmail String?  @map("contact_email")
  notes        String?
  createdAt    DateTime @default(now()) @map("created_at")

  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokens         ClientToken[]
  campaigns      Campaign[]
  scheduledPosts ScheduledPost[]

  @@map("clients")
}

model ClientToken {
  id                  String    @id @default(uuid())
  clientId            String    @map("client_id")
  platform            String
  accessToken         String    @map("access_token")
  refreshToken        String?   @map("refresh_token")
  expiresAt           DateTime? @map("expires_at")
  pageId              String?   @map("page_id")
  instagramAccountId  String?   @map("instagram_account_id")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@unique([clientId, platform])
  @@map("client_tokens")
}

model Campaign {
  id             String   @id @default(uuid())
  clientId       String   @map("client_id")
  name           String
  description    String?
  type           String   @default("custom")
  presetTemplate String?  @map("preset_template")
  frequency      String
  timesPerCycle  Int      @default(1) @map("times_per_cycle")
  scheduleConfig Json     @map("schedule_config")
  postToInstagram Boolean @default(true) @map("post_to_instagram")
  postToFacebook  Boolean @default(true) @map("post_to_facebook")
  postToStory     Boolean @default(true) @map("post_to_story")
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at")

  client         Client          @relation(fields: [clientId], references: [id], onDelete: Cascade)
  scheduledPosts ScheduledPost[]

  @@map("campaigns")
}

model ScheduledPost {
  id              String   @id @default(uuid())
  campaignId      String   @map("campaign_id")
  clientId        String   @map("client_id")
  scheduledFor    DateTime @map("scheduled_for")
  mediaType       String?  @map("media_type")
  mediaUrls       String[] @map("media_urls")
  caption         String?
  postToStory     Boolean  @default(true) @map("post_to_story")
  status          String   @default("pending")
  instagramResult Json?    @map("instagram_result")
  facebookResult  Json?    @map("facebook_result")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  campaign Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  client   Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@map("scheduled_posts")
}
```

- [ ] **Step 2: Reset and apply migration**

```bash
cd server && npx prisma migrate reset --force && npx prisma migrate dev --name init_redesign
```
Expected: Migration applied successfully

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd server && npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add server/prisma/
git commit -m "feat: rebuild prisma schema for client/campaign/post model"
```

---

## Task 3: Rebuild `server/index.js`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Replace `server/index.js`**

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const clientRoutes = require('./routes/clients');
const campaignRoutes = require('./routes/campaigns');
const postRoutes = require('./routes/posts');
const errorHandler = require('./middleware/errorHandler');

const app = express();

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/posts', postRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

// OAuth routes added in Phase 2
// Worker started in Phase 2

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
```

- [ ] **Step 2: Delete old unused files**

```bash
cd server
rm -f routes/upload.js
rm -f services/claudeService.js services/instagramService.js services/tiktokService.js
rm -f services/transcriptionService.js services/youtubeService.js
rm -f services/tokenRefresh.js services/encryption.js
```

- [ ] **Step 3: Start server and verify health**

```bash
cd server && npm run dev
```
In another terminal: `curl http://localhost:5000/api/health`
Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add server/index.js server/routes/ server/services/
git commit -m "feat: rebuild server entry point, remove old routes/services"
```

---

## Task 4: Settings Route

**Files:**
- Create: `server/routes/settings.js`

- [ ] **Step 1: Create `server/routes/settings.js`**

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/settings
router.get('/', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, metaAppId: true, theme: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// PUT /api/settings
router.put('/', auth, async (req, res) => {
  try {
    const { metaAppId, metaAppSecret, theme, password } = req.body;
    const data = {};

    if (metaAppId !== undefined) data.metaAppId = metaAppId;
    if (metaAppSecret !== undefined) data.metaAppSecret = metaAppSecret;
    if (theme && ['dark', 'light'].includes(theme)) data.theme = theme;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      data.passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data,
      select: { id: true, email: true, metaAppId: true, theme: true },
    });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Test manually**

```bash
# Login first, then:
curl -X GET http://localhost:5000/api/settings --cookie "token=<your-token>"
```
Expected: user object with `metaAppId: null`, `theme: "dark"`

- [ ] **Step 3: Commit**

```bash
git add server/routes/settings.js
git commit -m "feat: add settings route for meta credentials and theme"
```

---

## Task 5: Clients Route

**Files:**
- Create: `server/routes/clients.js`

- [ ] **Step 1: Create `server/routes/clients.js`**

```js
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

const logoStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/logos'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const uploadLogo = multer({ storage: logoStorage, limits: { fileSize: 2 * 1024 * 1024 } });

// GET /api/clients
router.get('/', auth, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { userId: req.userId },
      include: { tokens: { select: { platform: true } }, _count: { select: { campaigns: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

// POST /api/clients
router.post('/', auth, uploadLogo.single('logo'), async (req, res) => {
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
router.put('/:id', auth, uploadLogo.single('logo'), async (req, res) => {
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
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Create uploads/logos directory**

```bash
mkdir -p server/uploads/logos
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/clients.js server/uploads/logos/
git commit -m "feat: add clients CRUD route"
```

---

## Task 6: Slot Generator Service

**Files:**
- Create: `server/services/slotGenerator.js`
- Create: `server/services/templates.js`
- Create: `server/tests/slotGenerator.test.js`

- [ ] **Step 1: Write failing tests for `server/tests/slotGenerator.test.js`**

```js
const { generateSlots } = require('../services/slotGenerator');

describe('generateSlots', () => {
  const baseDate = new Date('2026-05-15T00:00:00.000Z');

  test('daily: generates correct number of slots', () => {
    const campaign = {
      id: 'camp-1',
      clientId: 'client-1',
      frequency: 'daily',
      timesPerCycle: 2,
      scheduleConfig: { times: ['09:00', '18:00'] },
      postToStory: true,
    };
    const slots = generateSlots(campaign, baseDate, 7);
    expect(slots.length).toBe(14); // 2 per day × 7 days
  });

  test('daily: slot scheduledFor has correct time', () => {
    const campaign = {
      id: 'camp-1',
      clientId: 'client-1',
      frequency: 'daily',
      timesPerCycle: 1,
      scheduleConfig: { times: ['09:00'] },
      postToStory: true,
    };
    const slots = generateSlots(campaign, baseDate, 1);
    expect(slots.length).toBe(1);
    const d = new Date(slots[0].scheduledFor);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(0);
  });

  test('weekly: generates slot only on specified day', () => {
    // May 15 2026 is a Friday (day 5)
    const campaign = {
      id: 'camp-1',
      clientId: 'client-1',
      frequency: 'weekly',
      timesPerCycle: 1,
      scheduleConfig: { days: ['friday'], time: '12:00' },
      postToStory: false,
    };
    const slots = generateSlots(campaign, baseDate, 14);
    expect(slots.length).toBe(2); // two Fridays in 14 days
    slots.forEach(s => {
      expect(new Date(s.scheduledFor).getUTCDay()).toBe(5); // 5 = Friday
    });
  });

  test('monthly: generates slot on correct date', () => {
    const campaign = {
      id: 'camp-1',
      clientId: 'client-1',
      frequency: 'monthly',
      timesPerCycle: 1,
      scheduleConfig: { date: 1, time: '10:00' },
      postToStory: true,
    };
    const slots = generateSlots(campaign, new Date('2026-05-01T00:00:00.000Z'), 60);
    expect(slots.length).toBe(2); // June 1 and July 1
    slots.forEach(s => {
      expect(new Date(s.scheduledFor).getUTCDate()).toBe(1);
    });
  });

  test('slots have correct shape', () => {
    const campaign = {
      id: 'camp-1',
      clientId: 'client-1',
      frequency: 'daily',
      timesPerCycle: 1,
      scheduleConfig: { times: ['09:00'] },
      postToStory: true,
    };
    const slots = generateSlots(campaign, baseDate, 1);
    const slot = slots[0];
    expect(slot).toHaveProperty('campaignId', 'camp-1');
    expect(slot).toHaveProperty('clientId', 'client-1');
    expect(slot).toHaveProperty('scheduledFor');
    expect(slot).toHaveProperty('status', 'pending');
    expect(slot).toHaveProperty('postToStory', true);
    expect(slot).toHaveProperty('mediaUrls');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd server && npx jest tests/slotGenerator.test.js
```
Expected: FAIL — `Cannot find module '../services/slotGenerator'`

- [ ] **Step 3: Create `server/services/slotGenerator.js`**

```js
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Generate scheduled_post objects (not yet saved to DB) for a campaign.
 * @param {object} campaign - campaign record with frequency, scheduleConfig, etc.
 * @param {Date} fromDate - start date (inclusive, UTC midnight)
 * @param {number} days - number of days to generate slots for
 * @returns {object[]} array of scheduled_post data objects
 */
function generateSlots(campaign, fromDate, days) {
  const slots = [];
  const { frequency, scheduleConfig, id: campaignId, clientId, postToStory } = campaign;

  if (frequency === 'daily') {
    const times = scheduleConfig.times || ['09:00'];
    for (let d = 0; d < days; d++) {
      for (const time of times) {
        const [hours, minutes] = time.split(':').map(Number);
        const dt = new Date(fromDate);
        dt.setUTCDate(dt.getUTCDate() + d);
        dt.setUTCHours(hours, minutes, 0, 0);
        if (dt > new Date()) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  } else if (frequency === 'weekly') {
    const targetDays = (scheduleConfig.days || []).map(d => DAY_NAMES.indexOf(d.toLowerCase()));
    const [hours, minutes] = (scheduleConfig.time || '09:00').split(':').map(Number);
    for (let d = 0; d < days; d++) {
      const dt = new Date(fromDate);
      dt.setUTCDate(dt.getUTCDate() + d);
      if (targetDays.includes(dt.getUTCDay())) {
        dt.setUTCHours(hours, minutes, 0, 0);
        if (dt > new Date()) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  } else if (frequency === 'monthly') {
    const targetDate = scheduleConfig.date || 1;
    const [hours, minutes] = (scheduleConfig.time || '09:00').split(':').map(Number);
    for (let d = 0; d < days; d++) {
      const dt = new Date(fromDate);
      dt.setUTCDate(dt.getUTCDate() + d);
      if (dt.getUTCDate() === targetDate) {
        dt.setUTCHours(hours, minutes, 0, 0);
        if (dt > new Date()) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  }

  return slots;
}

function makeSlot(campaignId, clientId, scheduledFor, postToStory) {
  return {
    campaignId,
    clientId,
    scheduledFor,
    mediaType: null,
    mediaUrls: [],
    caption: null,
    postToStory: postToStory ?? true,
    status: 'pending',
  };
}

module.exports = { generateSlots };
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd server && npx jest tests/slotGenerator.test.js
```
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Create `server/services/templates.js`**

```js
const TEMPLATES = [
  { key: 'brand_awareness', name: 'Brand Awareness', frequency: 'daily', timesPerCycle: 1, scheduleConfig: { times: ['09:00'] } },
  { key: 'daily_tips', name: 'Daily Tips', frequency: 'daily', timesPerCycle: 1, scheduleConfig: { times: ['09:00'] } },
  { key: 'weekly_highlight', name: 'Weekly Highlight', frequency: 'weekly', timesPerCycle: 1, scheduleConfig: { days: ['friday'], time: '12:00' } },
  { key: 'product_launch', name: 'Product Launch', frequency: 'daily', timesPerCycle: 3, scheduleConfig: { times: ['09:00', '13:00', '18:00'] } },
  { key: 'monthly_recap', name: 'Monthly Recap', frequency: 'monthly', timesPerCycle: 1, scheduleConfig: { date: 1, time: '10:00' } },
];

function getTemplate(key) {
  return TEMPLATES.find(t => t.key === key) || null;
}

module.exports = { TEMPLATES, getTemplate };
```

- [ ] **Step 6: Commit**

```bash
git add server/services/slotGenerator.js server/services/templates.js server/tests/slotGenerator.test.js
git commit -m "feat: add slot generator service and preset templates"
```

---

## Task 7: Campaigns Route

**Files:**
- Create: `server/routes/campaigns.js`

- [ ] **Step 1: Create `server/routes/campaigns.js`**

```js
const express = require('express');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');
const { generateSlots } = require('../services/slotGenerator');
const { getTemplate, TEMPLATES } = require('../services/templates');

const router = express.Router();

// GET /api/templates
router.get('/templates', auth, (req, res) => {
  res.json(TEMPLATES);
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

// POST /api/clients/:clientId/campaigns  (mounted under /api/campaigns via clients router)
// Actually mounted separately — see clients.js Task 8 note
// We'll mount as: POST /api/clients/:clientId/campaigns in clients.js

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
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Add campaign creation to `server/routes/clients.js`**

Add this route to `clients.js` before `module.exports`:

```js
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

    // If preset selected, use template defaults but allow overrides
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

    // Generate slots for the next 60 days
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
```

- [ ] **Step 3: Register campaign routes in `server/index.js`**

Add after existing route registrations:
```js
const campaignRoutes = require('./routes/campaigns');
app.use('/api/campaigns', campaignRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/campaigns.js server/routes/clients.js server/index.js
git commit -m "feat: add campaigns route with slot generation on creation"
```

---

## Task 8: Scheduled Posts Route

**Files:**
- Create: `server/routes/posts.js`

- [ ] **Step 1: Create `server/routes/posts.js`**

```js
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = file.mimetype.startsWith('video/') ? 'videos' : 'photos';
    const dir = path.join(__dirname, `../uploads/${type}`);
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const uploadMedia = multer({ storage: mediaStorage, limits: { fileSize: 100 * 1024 * 1024 } });

// Helper: verify post belongs to authed user's client
async function findPost(postId, userId) {
  return prisma.scheduledPost.findFirst({
    where: { id: postId, client: { userId } },
  });
}

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
      include: { client: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } } },
      orderBy: { scheduledFor: 'asc' },
      take: Number(limit),
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

// POST /api/posts/:id/media  — upload media files
router.post('/:id/media', auth, uploadMedia.array('media', 10), async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const firstFile = req.files[0];
    const isVideo = firstFile.mimetype.startsWith('video/');
    const mediaType = isVideo ? 'video' : (req.files.length > 1 ? 'carousel' : 'photo');
    const subdir = isVideo ? 'videos' : 'photos';
    const mediaUrls = req.files.map(f => `/uploads/${subdir}/${f.filename}`);

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { mediaType, mediaUrls, status: 'uploaded' },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// PUT /api/posts/:id  — update caption, story toggle
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { caption, postToStory } = req.body;
    const data = {};
    if (caption !== undefined) data.caption = caption;
    if (postToStory !== undefined) data.postToStory = postToStory;

    const updated = await prisma.scheduledPost.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// DELETE /api/posts/:id/media  — remove uploaded media, revert to pending
router.delete('/:id/media', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (['posting', 'posted'].includes(post.status)) {
      return res.status(400).json({ error: 'Cannot remove media from a posting or posted slot' });
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { mediaType: null, mediaUrls: [], status: 'pending' },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove media' });
  }
});

// POST /api/posts/:id/unpost  — attempt to delete from Meta (Phase 2 fills in Meta call)
router.post('/:id/unpost', auth, async (req, res) => {
  try {
    const post = await findPost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'posted') {
      return res.status(400).json({ error: 'Post has not been published yet' });
    }

    // Phase 2 will add Meta API deletion here.
    // For now, just revert status.
    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: { status: 'uploaded', instagramResult: null, facebookResult: null },
    });
    res.json({ message: 'Post reverted to uploaded status', post: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unpost' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register in `server/index.js`**

```js
const postRoutes = require('./routes/posts');
app.use('/api/posts', postRoutes);
```

- [ ] **Step 3: Test media upload endpoint manually**

```bash
curl -X POST http://localhost:5000/api/posts/<slot-id>/media \
  -F "media=@/path/to/test.jpg" \
  --cookie "token=<your-token>"
```
Expected: `{ "status": "uploaded", "mediaType": "photo", "mediaUrls": ["/uploads/photos/..."] }`

- [ ] **Step 4: Commit**

```bash
git add server/routes/posts.js server/index.js
git commit -m "feat: add scheduled posts route with media upload, caption, unpost"
```

---

## Task 9: Wire Up Client Campaign List Route

**Files:**
- Modify: `server/routes/clients.js`

- [ ] **Step 1: Add campaign list route to `server/routes/clients.js`**

Add before `module.exports`:

```js
const campaignRoutes = require('./campaigns');

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
```

- [ ] **Step 2: Verify full server starts cleanly**

```bash
cd server && npm run dev
```
Expected: `Server running on port 5000` — no errors

- [ ] **Step 3: Run all backend tests**

```bash
cd server && npx jest
```
Expected: slot generator tests pass

- [ ] **Step 4: Commit**

```bash
git add server/routes/clients.js
git commit -m "feat: add client campaign list and verify server health"
```

---

## Phase 1 Complete

Phase 1 delivers a fully functional backend API:
- ✅ Prisma schema rebuilt (users, clients, client_tokens, campaigns, scheduled_posts)
- ✅ Auth unchanged (cookie JWT)
- ✅ Settings route (Meta credentials, theme)
- ✅ Clients CRUD with logo upload
- ✅ Campaigns route with slot generation
- ✅ Scheduled posts route (media upload, caption, story toggle, unpost stub)
- ✅ Slot generator tested

**Next:** [Phase 2 — Meta API Integration](./2026-05-15-phase2-meta-api.md)
