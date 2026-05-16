# Postify Redesign — Design Spec

**Date:** 2026-05-15  
**Status:** Approved for implementation

---

## Overview

Postify is a social media management web app for marketing agencies. An agency user logs in, manages a list of clients, creates recurring posting campaigns for each client, uploads media (video, photo, or carousel) with captions per post slot, and the app automatically publishes to each client's Instagram and Facebook accounts (feed + story) on schedule via the Meta Graph API.

This is a **full rebuild** of the existing codebase. The existing schema (TikTok, YouTube, no client management) is replaced entirely. The tech stack is preserved: Node/Express + React + PostgreSQL + Prisma.

---

## Tech Stack

- **Backend:** Node.js + Express, Prisma ORM, PostgreSQL
- **Frontend:** React + React Router
- **File uploads:** Multer (video, photos stored on disk)
- **Scheduling:** DB-driven polling worker (runs in-process every 60s)
- **Social API:** Meta Graph API (Instagram + Facebook)
- **Auth:** JWT (existing pattern)
- **Monorepo:** `/server` + `/client`

---

## Database Schema

### `users`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | string unique | |
| password_hash | string | |
| meta_app_id | string nullable | Meta Developer App ID |
| meta_app_secret | string nullable | Meta Developer App Secret |
| theme | enum (dark/light) | default: dark |
| created_at | timestamp | |

### `clients`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| name | string | Short display name (e.g. "Nike NY") |
| business_name | string nullable | Legal/full name |
| logo_url | string nullable | Uploaded logo |
| website | string nullable | |
| industry | string nullable | |
| contact_name | string nullable | |
| contact_email | string nullable | |
| notes | text nullable | |
| created_at | timestamp | |

### `client_tokens`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| platform | enum (instagram/facebook) | |
| access_token | string | OAuth access token |
| refresh_token | string nullable | |
| expires_at | timestamp nullable | |
| page_id | string nullable | Facebook Page ID |
| instagram_account_id | string nullable | IG Business Account ID |
| created_at | timestamp | |
| updated_at | timestamp | |

Unique constraint: (client_id, platform)

### `campaigns`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| name | string | |
| description | string nullable | |
| type | enum (preset/custom) | |
| preset_template | string nullable | e.g. "brand_awareness", "daily_tips" |
| frequency | enum (daily/weekly/monthly) | |
| times_per_cycle | int | e.g. 3 for "3x daily" |
| schedule_config | JSON | See below |
| post_to_instagram | bool | default: true |
| post_to_facebook | bool | default: true |
| post_to_story | bool | default: true (per-campaign default, overridable per slot) |
| is_active | bool | default: true |
| created_at | timestamp | |

**schedule_config shape:**
```json
// Daily: { "times": ["09:00", "13:00", "18:00"] }
// Weekly: { "days": ["friday"], "time": "12:00" }
// Monthly: { "date": 15, "time": "10:00" }
```

### `scheduled_posts`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_id | uuid FK → campaigns | |
| client_id | uuid FK → clients | denormalized for fast queries |
| scheduled_for | timestamp | Exact UTC datetime to publish |
| media_type | enum (video/photo/carousel) nullable | Set when media uploaded |
| media_urls | string[] | Video path or array of photo paths |
| caption | text nullable | |
| post_to_story | bool | Inherits campaign default, overridable |
| status | enum | pending / uploaded / posting / posted / failed |
| instagram_result | JSON nullable | API response |
| facebook_result | JSON nullable | API response |
| created_at | timestamp | |
| updated_at | timestamp | |

---

## API Routes

### Auth
- `POST /api/auth/register` — email + password
- `POST /api/auth/login` — returns JWT
- `POST /api/auth/logout`

### Settings
- `GET /api/settings` — returns user profile + meta credentials + theme
- `PUT /api/settings` — update meta_app_id, meta_app_secret, theme, password

### Clients
- `GET /api/clients` — list all clients for authed user
- `POST /api/clients` — create client
- `GET /api/clients/:id` — client detail + tokens + campaigns
- `PUT /api/clients/:id` — update client info
- `DELETE /api/clients/:id` — delete client

### OAuth (Meta)
- `GET /api/clients/:id/connect/:platform` — initiates OAuth redirect (instagram/facebook)
- `GET /api/oauth/callback` — Meta OAuth callback, stores token
- `DELETE /api/clients/:id/tokens/:platform` — disconnect platform

### Campaigns
- `GET /api/clients/:id/campaigns` — list campaigns for client
- `POST /api/clients/:id/campaigns` — create campaign, generates scheduled_post slots
- `GET /api/campaigns/:id` — campaign detail + post slots
- `PUT /api/campaigns/:id` — update campaign (name, active status)
- `DELETE /api/campaigns/:id`

### Scheduled Posts (slots)
- `GET /api/posts?clientId=&status=&upcoming=` — dashboard queries (all to-dos, upcoming)
- `GET /api/campaigns/:id/posts` — all slots for a campaign
- `POST /api/posts/:id/media` — upload media (multer); sets media_type, media_urls, status→uploaded
- `PUT /api/posts/:id` — update caption, post_to_story, replace media
- `DELETE /api/posts/:id/media` — remove uploaded media, revert to pending
- `POST /api/posts/:id/unpost` — attempt to delete post from Meta (best-effort; Meta may reject deletion for old posts); on success reverts status to uploaded, on failure returns error without changing status

### Preset Templates
- `GET /api/templates` — list preset campaign templates (static list)

---

## Frontend Pages & Components

### Pages
| Route | Page | Description |
|---|---|---|
| `/login` | Login | Email + password |
| `/register` | Register | |
| `/` | Dashboard | All to-dos + upcoming posts across all clients |
| `/clients/:id` | Client Profile | Business info, social connections, campaigns list |
| `/campaigns/:id` | Campaign View | Post slots with media upload + management |
| `/settings` | Settings | Meta App credentials, theme toggle, account info |

### Persistent Layout
- **Left sidebar** (always visible when logged in):
  - Postify logo
  - Home link
  - Clients list (scrollable) + Add Client button
  - Settings + User profile at bottom
- **Main content area:** swaps based on route

### Key Components
- `MediaSlot` — single post slot card; handles video/photo/carousel upload, preview modal, replace, delete, story toggle, unpost
- `CampaignWizard` — 5-step modal: Name → Type → Frequency → Schedule → Platforms
- `NewClientModal` — form modal for creating a client
- `TodoList` — dashboard to-do list, grouped by urgency
- `UpcomingPosts` — dashboard upcoming posts feed across all clients
- `OAuthConnectButton` — per-platform connect/reconnect/disconnect for client profile

### Theme
- **Default:** Dark mode — dark navy backgrounds (#0d1117, #161b22), blue accent (#2563eb)
- **Light mode:** toggleable in Settings; stored in `users.theme`; applied via `<body class="theme-light">`

---

## Campaign Slot Generation

When a campaign is created, the backend generates `scheduled_posts` rows for the next **60 days** based on `schedule_config`:

- **Daily:** one slot per time per day × 60 days
- **Weekly:** one slot per scheduled day/time per week × ~8 weeks
- **Monthly:** one slot per month × 2 months

All slots start with `status = pending`. As the campaign continues, new slots are generated on a rolling basis (worker generates slots 30 days out if fewer than 14 future slots exist).

---

## Background Worker

Runs in-process (same Node server), polling every 60 seconds.

**Job 1 — Publish due posts:**
1. Query `scheduled_posts` WHERE `status = 'uploaded'` AND `scheduled_for <= NOW()`
2. For each post: mark `status = 'posting'`
3. Fetch client tokens for the post's client
4. Call Meta Graph API:
   - Instagram: publish to feed (video/photo/carousel via Container API), then story if enabled
   - Facebook: publish to Page feed, then story if enabled
5. On success: `status = 'posted'`, store API result JSON
6. On failure: `status = 'failed'`, store error

**Job 2 — Rolling slot generation:**
1. For each active campaign, count future `scheduled_posts` slots
2. If fewer than 14 future slots exist, generate 30 more days of slots

---

## Meta API Integration

- User stores their own **Meta App ID + App Secret** in Settings
- Each client connects their Instagram Business account and/or Facebook Page via **OAuth 2.0**
- Tokens stored in `client_tokens`; refreshed automatically when expired
- Publishing uses the **Instagram Graph API** (Container → Publish flow) and **Facebook Pages API**
- Stories: separate API call after feed post using the same media

### Preset Campaign Templates
| Key | Name | Default Schedule |
|---|---|---|
| `brand_awareness` | Brand Awareness | 1× daily |
| `daily_tips` | Daily Tips | 1× daily at 9am |
| `weekly_highlight` | Weekly Highlight | 1× weekly, Friday |
| `product_launch` | Product Launch | 3× daily |
| `monthly_recap` | Monthly Recap | 1× monthly, 1st of month |

User can override schedule after selecting a preset.

---

## Error Handling

- Failed posts marked `status = 'failed'` with error stored in result JSON
- Dashboard surfaces failed posts as a separate to-do category
- OAuth token expiry: worker skips post, marks failed, user sees "Reconnect" prompt on client profile
- Media upload errors: returned immediately to frontend with descriptive message

---

## What Is NOT in Scope

- Email notifications / push notifications
- Multiple agency users sharing clients (single-user per account)
- Analytics / post performance metrics
- AI-generated captions
- Scheduling ads (only organic posts)
- Mobile app
