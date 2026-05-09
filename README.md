# Postify 🚀

**One upload. Every platform.** Postify lets you drag-and-drop a video and automatically post it to YouTube Shorts, Instagram Reels, and TikTok with AI-generated titles, descriptions, and hashtags.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS v4 |
| Backend | Node.js + Express |
| Database | PostgreSQL + Prisma ORM |
| AI Captions | Anthropic Claude (claude-haiku-4-5) |
| Transcription | Groq Whisper / OpenAI Whisper |
| Auth | JWT in httpOnly cookies + bcrypt |
| Encryption | AES-256-GCM for all secrets |
| Hosting | Render.com |

---

## Local Development Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd Postify
npm run install:all
```

### 2. Set up environment variables

```bash
cp .env.example server/.env
```

Edit `server/.env` with your actual values:

```env
DATABASE_URL="postgresql://..."
JWT_SECRET="random-32-char-string"
ENCRYPTION_KEY="another-random-32-char-string"
ANTHROPIC_API_KEY="sk-ant-..."       # Optional fallback key
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
META_CLIENT_ID="..."
META_CLIENT_SECRET="..."
TIKTOK_CLIENT_ID="..."
TIKTOK_CLIENT_SECRET="..."
SERVER_URL="http://localhost:5000"
CLIENT_URL="http://localhost:5173"
```

### 3. Set up the database

```bash
# Push schema to your PostgreSQL database
npm run db:push

# Or run migrations (for production)
npm run db:migrate
```

### 4. Start development servers

```bash
npm run dev
```

This starts both the backend (port 5000) and frontend (port 5173) concurrently.

---

## Setting Up OAuth Credentials

### YouTube (Google)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project → Enable **YouTube Data API v3**
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: `http://localhost:5000/api/oauth/youtube/callback`
5. Copy Client ID and Client Secret to `.env`

### Instagram (Meta)

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app → Add **Instagram Graph API** product
3. Add OAuth redirect URI: `http://localhost:5000/api/oauth/instagram/callback`
4. Copy App ID and App Secret to `.env`
5. **Note:** Requires a Facebook Page linked to an Instagram Business/Creator account

### TikTok

1. Go to [TikTok for Developers](https://developers.tiktok.com/)
2. Create an app → Add **Content Posting API** product
3. Add redirect URI: `http://localhost:5000/api/oauth/tiktok/callback`
4. Copy Client Key and Client Secret to `.env`

---

## Deploying to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your GitHub repo — Render will detect `render.yaml`
4. Set all environment variables marked `sync: false` in the Render dashboard
5. Set `SERVER_URL` to your backend Render URL (e.g. `https://postify-server.onrender.com`)
6. Set `CLIENT_URL` to your frontend Render URL (e.g. `https://postify.onrender.com`)
7. Update OAuth redirect URIs in Google/Meta/TikTok consoles to use production URLs

---

## Project Structure

```
Postify/
├── client/                  # React frontend
│   └── src/
│       ├── pages/           # Login, Register, Dashboard, Upload, Settings
│       ├── components/      # DropZone, PlatformCard, ProgressBar, PostStatus, ApiKeyInput
│       ├── hooks/           # useAuth, usePlatforms
│       └── utils/           # api.js (axios instance)
├── server/                  # Express backend
│   ├── routes/              # auth, oauth, upload, posts, settings
│   ├── middleware/          # authMiddleware, errorHandler
│   ├── services/            # claude, transcription, youtube, instagram, tiktok
│   ├── utils/               # encryption (AES-256), tokenRefresh
│   ├── prisma/              # schema.prisma
│   └── uploads/             # Temp video files (auto-deleted after posting)
├── .env.example
├── render.yaml
└── README.md
```

---

## Security

- All OAuth tokens and API keys are **AES-256-GCM encrypted** before database storage
- JWT stored in **httpOnly cookies** (not localStorage)
- Video files are **permanently deleted** from server after all platform posts complete
- Raw API keys are **never logged** anywhere in the codebase
- Passwords are hashed with **bcrypt** (12 rounds)
