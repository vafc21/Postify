# Postify

**Social media management for agencies.** Postify lets you manage clients, create recurring posting campaigns, upload media with captions, and automatically publish to Instagram and Facebook on schedule via the Meta Graph API.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS v4 |
| Backend | Node.js + Express |
| Database | PostgreSQL + Prisma ORM |
| Social API | Meta Graph API v18.0 (Instagram + Facebook) |
| Auth | JWT in httpOnly cookies + bcrypt |
| Encryption | AES-256-GCM for all secrets |

---

## Local Development Setup

### 1. Clone and install

```bash
git clone https://github.com/vafc21/Postify.git
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
SERVER_URL="http://localhost:5000"
CLIENT_URL="http://localhost:5173"
```

### 3. Set up the database

```bash
npm run db:push
```

### 4. Start development servers

```bash
npm run dev
```

This starts both the backend (port 5000) and frontend (port 5173) concurrently.

---

## Setting Up Meta API

Postify publishes to Instagram and Facebook via the Meta Graph API. Each agency user stores their own Meta Developer App credentials in Settings.

### Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app → choose **Business** type
3. Add the **Instagram Graph API** and **Facebook Pages API** products
4. Under OAuth settings, add redirect URI: `http://localhost:5000/api/oauth/callback`
5. Copy your **App ID** and **App Secret** into Postify's Settings page

### Required Permissions

- `pages_manage_posts`
- `pages_read_engagement`
- `instagram_basic`
- `instagram_content_publish`

### Connecting a Client Account

From a client's profile page, click **Connect** next to Instagram or Facebook. This opens a Meta OAuth popup — the client authorizes your app and the token is stored automatically.

**Note:** Instagram publishing requires the client's Instagram account to be a Business or Creator account linked to a Facebook Page.

---

## Project Structure

```
Postify/
├── client/                  # React frontend
│   └── src/
│       ├── pages/           # Login, Register, Dashboard, ClientProfile, CampaignView, Settings
│       ├── components/      # Layout, Sidebar, NewClientModal, CampaignWizard, MediaSlot
│       ├── contexts/        # AuthContext, ThemeContext
│       └── api.js           # Axios instance
├── server/                  # Express backend
│   ├── routes/              # auth, settings, clients, campaigns, posts, oauth
│   ├── middleware/          # authMiddleware, errorHandler
│   ├── services/            # meta, worker, slotGenerator, templates
│   ├── utils/               # encryption (AES-256), prisma
│   ├── prisma/              # schema.prisma
│   └── uploads/             # Uploaded media files
└── README.md
```

---

## Security

- OAuth tokens and Meta App secrets are **AES-256-GCM encrypted** before database storage
- JWT stored in **httpOnly cookies** (not localStorage)
- Passwords are hashed with **bcrypt** (12 rounds)
- Meta App Secret is **never returned** by the API
