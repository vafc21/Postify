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
const oauthRoutes = require('./routes/oauth');
const errorHandler = require('./middleware/errorHandler');
const auth = require('./middleware/authMiddleware');
const { TEMPLATES } = require('./services/templates');

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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/oauth', oauthRoutes);
// Spec: GET /api/templates (also available at GET /api/campaigns/templates)
app.get('/api/templates', auth, (req, res) => res.json(TEMPLATES));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const clientDistPath = path.join(__dirname, 'public');
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.use(errorHandler);

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('ADMIN_EMAIL or ADMIN_PASSWORD not set — no admin user seeded');
    return;
  }
  const bcrypt = require('bcryptjs');
  const prisma = require('./utils/prisma');
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  console.log(`Admin user ready: ${email}`);
}

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test') {
  seedAdminUser().catch(err => {
    console.error('Warning: failed to seed admin user:', err.message);
  }).finally(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    const { startWorker } = require('./services/worker');
    startWorker();
  });
}

module.exports = app;
