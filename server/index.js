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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/posts', postRoutes);
// Spec: GET /api/templates (also available at GET /api/campaigns/templates)
app.get('/api/templates', auth, (req, res) => res.json(TEMPLATES));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

// OAuth routes added in Phase 2
// Worker started in Phase 2

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
