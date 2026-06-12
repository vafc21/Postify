/**
 * Storrito provider — publishes Instagram Stories with NATIVE interactive
 * stickers (polls, link stickers, hashtags, mentions) that Meta's Graph API does
 * not expose. Storrito accepts a Story as HTML built from `<insta-story>` web
 * components and posts it by automating the Instagram app on its side.
 *
 * SCAFFOLDING STATUS: the exact request/response schemas live behind a Storrito
 * login (API Credentials → Documentation) and are NOT yet confirmed. Everything
 * marked `TODO(storrito-docs)` is a best-effort guess from the public help pages
 * and must be verified against the real API reference before this goes live.
 *
 * SAFETY: every network call is gated by `isConfigured()`. With no token/base on
 * the user (the default today), the public functions throw
 * StorritoNotConfiguredError and the publish path silently falls back to the
 * Graph story — so wiring this in changes NOTHING until an operator pastes creds.
 */
const axios = require('axios');
const { readToken } = require('../utils/encryption');

// Sticker types that ONLY Storrito can render natively — their presence in a
// story layout is what flips publishing from the Graph path to Storrito. A plain
// self-`mention` is intentionally excluded: the Graph API can already do that one
// via user_tags, so a mention-only story doesn't need to incur Storrito cost.
const STORRITO_ONLY_TYPES = new Set(['link', 'hashtag', 'poll']);

// Storrito's own published rate limits (help center): used to fail fast with a
// clear message rather than letting Instagram silently throttle.
const STORY_DIMENSIONS = { width: 1080, height: 1920 };

class StorritoNotConfiguredError extends Error {
  constructor(msg = 'Storrito API is not configured for this operator') {
    super(msg);
    this.name = 'StorritoNotConfiguredError';
    this.code = 'STORRITO_NOT_CONFIGURED';
  }
}

/** True when the operator (User) has both a Storrito token and base URL set. */
function isConfigured(user) {
  return !!(user && user.storritoApiToken && user.storritoApiBase);
}

/** Does this story layout contain a sticker only Storrito can publish natively? */
function layoutHasNativeStickers(layout) {
  if (!layout || !Array.isArray(layout.elements)) return false;
  return layout.elements.some((el) => el && STORRITO_ONLY_TYPES.has(el.type));
}

/**
 * Explain why a sticker story could NOT be routed through Storrito — for alerting
 * the operator that interactive stickers got dropped. Returns null when there's
 * no gap to flag (the story has no native stickers, or Storrito is fully ready).
 * Otherwise a reason code:
 *   'no_api_credentials'  — operator hasn't set a Storrito token (Settings)
 *   'client_not_connected'— client opted into Stories but isn't linked in Storrito
 * Mirrors the positive routing check in meta.js so the two never disagree.
 */
function stickerGapReason(user, client, layout) {
  if (!client || !client.usesStories) return null;
  if (!layoutHasNativeStickers(layout)) return null;
  if (!isConfigured(user)) return 'no_api_credentials';
  if (!client.storritoUsername) return 'client_not_connected';
  return null;
}

/**
 * Build an authenticated axios client bound to the operator's Storrito account.
 * The token is decrypted here (stored encrypted at rest, like metaAppSecret).
 */
function clientFor(user) {
  if (!isConfigured(user)) throw new StorritoNotConfiguredError();
  const token = readToken(user.storritoApiToken);
  return axios.create({
    baseURL: user.storritoApiBase.replace(/\/+$/, ''),
    timeout: 30000,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

/**
 * List the Instagram accounts connected to this Storrito account. Postify matches
 * one of these to a Postify client (by IG username) to mark Stories "Connected".
 * Returns [{ instagramUsername }, ...].
 *
 * CONFIRMED from Storrito's public API page (verbatim curl):
 *   curl -X POST https://YOUR-BASE-URL/api/v1/list-instagram-users \
 *     -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" -d '{}'
 * Only the response envelope shape (array vs { instagramUsers }) is still
 * defensively handled below until the in-account docs confirm it.
 */
async function listInstagramUsers(user) {
  const http = clientFor(user);
  const { data } = await http.post('/api/v1/list-instagram-users', {});
  const list = Array.isArray(data) ? data : (data?.instagramUsers || data?.users || []);
  return list
    .map((u) => ({
      instagramUsername: (u.instagramUsername || u.username || '').replace(/^@/, ''),
      raw: u,
    }))
    .filter((u) => u.instagramUsername);
}

/**
 * Translate a Postify story layout into Storrito's `<insta-story>` HTML.
 *
 * The fully rendered 9:16 card (text, the reshared post image, background) is
 * passed as `backgroundUrl` and baked in as the base image — so here we only emit
 * the INTERACTIVE stickers that must stay native and tappable. Element coords are
 * normalized 0–1, mapped to left/top percentages.
 *
 * TODO(storrito-docs): confirm the exact custom-element tag names and attributes
 * (`<insta-link href>`, `<insta-hashtag>`, `<insta-mention>`, `<insta-poll>`).
 */
function buildInstaStoryHtml({ backgroundUrl, layout, fallbackMentionUsername }) {
  const { width, height } = STORY_DIMENSIONS;
  const pct = (v) => `${Math.max(0, Math.min(1, Number(v) || 0)) * 100}%`;
  const at = (el) => `position:absolute;left:${pct(el.x)};top:${pct(el.y)};transform:translate(-50%,-50%)`;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const stickers = [];
  for (const el of (layout?.elements || [])) {
    if (!el) continue;
    if (el.type === 'link' && el.url) {
      stickers.push(`<insta-link style="${at(el)}" href="${esc(el.url)}">${esc(el.label || 'Visit')}</insta-link>`);
    } else if (el.type === 'hashtag' && el.tag) {
      stickers.push(`<insta-hashtag style="${at(el)}">${esc(String(el.tag).replace(/^#/, ''))}</insta-hashtag>`);
    } else if (el.type === 'poll' && el.question) {
      const opts = Array.isArray(el.options) && el.options.length >= 2 ? el.options : ['Yes', 'No'];
      stickers.push(`<insta-poll style="${at(el)}" question="${esc(el.question)}" option1="${esc(opts[0])}" option2="${esc(opts[1])}"></insta-poll>`);
    } else if (el.type === 'mention' && (el.username || fallbackMentionUsername)) {
      stickers.push(`<insta-mention style="${at(el)}">${esc((el.username || fallbackMentionUsername).replace(/^@/, ''))}</insta-mention>`);
    }
  }

  return [
    `<insta-story width="${width}" height="${height}">`,
    `  <img src="${esc(backgroundUrl)}" width="${width}" height="${height}" style="position:absolute;inset:0" />`,
    ...stickers.map((s) => `  ${s}`),
    `</insta-story>`,
  ].join('\n');
}

/**
 * Publish (or immediately schedule) one sticker story to a connected IG account.
 *
 * @param {object}  user                operator with Storrito creds
 * @param {string}  instagramUsername   the Storrito-connected handle for this client
 * @param {string}  backgroundUrl       absolute URL to the rendered 9:16 card
 * @param {object}  layout              the story layout (source of native stickers)
 * @param {string}  fallbackMentionUsername  used for a bare self-mention element
 * @returns {{ storyId: string, raw: object }}
 *
 * CONFIRMED from the public API page: the endpoint is `schedule-instagram-story`
 * and it consumes the `instagramUsername` from list-instagram-users plus a Story
 * built from `<insta-story>` HTML. The exact BODY FIELD NAME for the HTML is the
 * one thing still unconfirmed — `html` is the working guess; the in-account docs
 * may call it `story` / `storyHtml` / `content` (a one-line change if so).
 * `scheduledAt` omitted = post now (Postify already owns the schedule).
 */
async function publishStickerStory({ user, instagramUsername, backgroundUrl, layout, fallbackMentionUsername }) {
  const http = clientFor(user);
  const html = buildInstaStoryHtml({ backgroundUrl, layout, fallbackMentionUsername });
  const { data } = await http.post('/api/v1/schedule-instagram-story', {
    instagramUsername,
    html,
  });
  return { storyId: data?.id || data?.storyId || data?.jobId || null, raw: data };
}

/**
 * Cancel a still-queued Storrito story. Best-effort; safe to call speculatively.
 * TODO(storrito-docs): path follows the observed `-instagram-story` naming, but
 * cancel/status aren't shown publicly — confirm against the in-account reference.
 */
async function cancelStory(user, storyId) {
  if (!storyId) return false;
  const http = clientFor(user);
  await http.post('/api/v1/cancel-instagram-story', { id: storyId });
  return true;
}

/** Poll the status of a submitted story (queued | posted | failed). TBD path. */
async function getStoryStatus(user, storyId) {
  const http = clientFor(user);
  const { data } = await http.post('/api/v1/instagram-story-status', { id: storyId });
  return data?.status || data?.state || 'unknown';
}

module.exports = {
  StorritoNotConfiguredError,
  STORRITO_ONLY_TYPES,
  isConfigured,
  layoutHasNativeStickers,
  stickerGapReason,
  listInstagramUsers,
  buildInstaStoryHtml,
  publishStickerStory,
  cancelStory,
  getStoryStatus,
};
