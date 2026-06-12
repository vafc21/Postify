/**
 * Storrito provider — publishes Instagram Stories with NATIVE interactive
 * stickers (polls, link stickers, hashtags, mentions, location) that Meta's
 * Graph API does not expose. Storrito accepts a Story as HTML built from
 * `<insta-story>` web components and posts it by automating Instagram on its side.
 *
 * The request/response schemas below are CONFIRMED against Storrito's published
 * API reference (account → API Credentials → Documentation, and the public
 * help-center copy at https://storrito.com/help-center/storrito-api/). All
 * procedures are HTTP POST under `<base>/api/v1/<procedure>` with a Bearer token
 * and a JSON map body; the API validates params strictly (unknown keys are
 * rejected), so we only ever send documented fields.
 *
 * SAFETY: every network call is gated by `isConfigured()`. With no token/base on
 * the user (the default today), the public functions throw
 * StorritoNotConfiguredError and the publish path silently falls back to the
 * Graph story — so wiring this in changes NOTHING until an operator pastes creds.
 */
const crypto = require('crypto');
const axios = require('axios');
const { readToken } = require('../utils/encryption');

// Sticker types that ONLY Storrito can render natively — their presence in a
// story layout is what flips publishing from the Graph path to Storrito. A plain
// self-`mention` is intentionally excluded: the Graph API can already do that one
// via user_tags, so a mention-only story doesn't need to incur Storrito cost.
const STORRITO_ONLY_TYPES = new Set(['link', 'hashtag', 'poll']);

// The story canvas is a fixed 1080x1920 (9:16) — there are no width/height
// attributes on <insta-story>; positioning is plain absolute CSS in this space.
const STORY_DIMENSIONS = { width: 1080, height: 1920 };

// HTTP statuses the API tells us to retry: 429 (rate limit, default 60 req/min)
// and the load-balancer's 502/503/504 during deploys. Retry with ~2s + jitter.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build an authenticated axios client bound to the operator's Storrito account.
 * The token is decrypted here (stored encrypted at rest, like metaAppSecret).
 * `storritoApiBase` is the per-account host (e.g. https://<uuid>.storrito.com);
 * the `/api/v1/<procedure>` path is appended by `rpc`.
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
 * Call one API procedure with the retry/backoff the docs require: on 429 and
 * transient 5xx (502/503/504) wait ~2s + 0-999ms jitter and retry, up to 5
 * attempts. Every other error (400 validation, 401 auth, 500) is thrown as-is.
 * Returns the parsed response map.
 */
async function rpc(http, procedure, params = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data } = await http.post(`/api/v1/${procedure}`, params);
      return data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS) {
        await sleep(2000 + Math.floor(Math.random() * 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * List the Instagram accounts connected to this Storrito account. Postify matches
 * one of these to a Postify client (by IG username) to mark Stories "Connected".
 * Returns [{ instagramUsername, instagramId, raw }, ...].
 *
 * CONFIRMED: `list-instagram-users` returns { instagramUsers: [{ instagramId,
 * instagramUsername }] }. The array/`users` fallbacks are kept defensively.
 */
async function listInstagramUsers(user) {
  const http = clientFor(user);
  const data = await rpc(http, 'list-instagram-users', {});
  const list = Array.isArray(data) ? data : (data?.instagramUsers || data?.users || []);
  return list
    .map((u) => ({
      instagramUsername: (u.instagramUsername || u.username || '').replace(/^@/, ''),
      instagramId: u.instagramId || u.id || null,
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
 * normalized 0–1 and mapped to absolute pixels on the 1080x1920 canvas, centered
 * on the point. Sticker data lives in component ATTRIBUTES (not text content):
 *   <insta-link url text> · <insta-hashtag hashtag> · <insta-mention username>
 *   <insta-poll question options(JSON)> · <insta-location location location-id>
 */
function buildInstaStoryHtml({ backgroundUrl, layout, fallbackMentionUsername }) {
  const { width, height } = STORY_DIMENSIONS;
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const px = (v, span) => `${Math.round(clamp01(v) * span)}px`;
  const at = (el) => `position:absolute;left:${px(el.x, width)};top:${px(el.y, height)};transform:translate(-50%,-50%)`;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const stickers = [];
  for (const el of (layout?.elements || [])) {
    if (!el) continue;
    if (el.type === 'link' && el.url) {
      const text = el.label ? ` text="${esc(el.label)}"` : '';
      stickers.push(`<insta-link style="${at(el)}" url="${esc(el.url)}"${text}></insta-link>`);
    } else if (el.type === 'hashtag' && el.tag) {
      stickers.push(`<insta-hashtag style="${at(el)}" hashtag="${esc(String(el.tag).replace(/^#/, ''))}"></insta-hashtag>`);
    } else if (el.type === 'poll' && el.question) {
      const opts = (Array.isArray(el.options) && el.options.length >= 2 ? el.options : ['Yes', 'No'])
        .slice(0, 4).map((o) => String(o));
      stickers.push(`<insta-poll style="${at(el)}" question="${esc(el.question)}" options="${esc(JSON.stringify(opts))}"></insta-poll>`);
    } else if (el.type === 'mention' && (el.username || fallbackMentionUsername)) {
      stickers.push(`<insta-mention style="${at(el)}" username="${esc((el.username || fallbackMentionUsername).replace(/^@/, ''))}"></insta-mention>`);
    } else if (el.type === 'location' && el.location) {
      const locId = el.locationId ? ` location-id="${esc(el.locationId)}"` : '';
      stickers.push(`<insta-location style="${at(el)}" location="${esc(el.location)}"${locId}></insta-location>`);
    }
  }

  return [
    '<insta-story>',
    `  <img src="${esc(backgroundUrl)}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover" />`,
    ...stickers.map((s) => `  ${s}`),
    '</insta-story>',
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
 * @param {string}  [storyPostUuid]     caller-supplied idempotency UUID; one is
 *                                      generated when omitted
 * @returns {{ storyId: string, status: string, raw: object }}  storyId is the
 *          storyPostUuid — pass it to getStoryStatus/cancelStory.
 *
 * CONFIRMED: `schedule-instagram-story` requires `instagramUsername` and
 * `storyPostUuid`; the story HTML goes in `html` (or a hosted `url`); an optional
 * ISO-8601 `date` schedules for later (omitted = post now — Postify owns timing).
 * Re-sending the same `storyPostUuid` is idempotent, so retries can't double-post.
 * The response echoes { storyPostUuid, status: "scheduled" }.
 */
async function publishStickerStory({ user, instagramUsername, backgroundUrl, layout, fallbackMentionUsername, storyPostUuid }) {
  const http = clientFor(user);
  const html = buildInstaStoryHtml({ backgroundUrl, layout, fallbackMentionUsername });
  const uuid = storyPostUuid || crypto.randomUUID();
  const data = await rpc(http, 'schedule-instagram-story', {
    instagramUsername,
    storyPostUuid: uuid,
    html,
  });
  return { storyId: data?.storyPostUuid || uuid, status: data?.status || null, raw: data };
}

/**
 * Cancel a still-queued Storrito story. Best-effort; safe to call speculatively
 * and idempotent server-side. Throws if the story already executed/failed.
 * CONFIRMED: `cancel-instagram-story` takes { storyPostUuid }.
 */
async function cancelStory(user, storyPostUuid) {
  if (!storyPostUuid) return false;
  const http = clientFor(user);
  await rpc(http, 'cancel-instagram-story', { storyPostUuid });
  return true;
}

/**
 * Poll the posting status of a submitted story.
 * CONFIRMED: `status-instagram-story` takes { storyPostUuid } and returns
 * { storyPostUuid, status, errorMessage? } where status is one of
 * scheduled | executed | failed | canceled.
 */
async function getStoryStatus(user, storyPostUuid) {
  const http = clientFor(user);
  const data = await rpc(http, 'status-instagram-story', { storyPostUuid });
  return data?.status || 'unknown';
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
