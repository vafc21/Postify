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
const STORRITO_ONLY_TYPES = new Set(['link', 'hashtag', 'poll', 'location']);

// The story canvas is a fixed 1080x1920 (9:16) — there are no width/height
// attributes on <insta-story>; positioning is plain absolute CSS in this space.
const STORY_DIMENSIONS = { width: 1080, height: 1920 };

// Per-sticker style variant: which attribute carries it, the allowed values, and
// the default (omitted from the HTML). MUST mirror the client VARIANTS in
// client/src/components/storyStickers.jsx.
const STICKER_VARIANTS = {
  link:     { attr: 'design', allowed: ['default', 'gray', 'black', 'rainbow'], def: 'default' },
  hashtag:  { attr: 'design', allowed: ['default', 'gray', 'rainbow'], def: 'default' },
  mention:  { attr: 'design', allowed: ['default', 'gray', 'rainbow'], def: 'default' },
  location: { attr: 'design', allowed: ['default', 'gray', 'black', 'orange', 'rainbow'], def: 'default' },
  poll:     { attr: 'color', allowed: ['black', 'pink', 'lavender', 'purple', 'orange', 'green', 'blue'], def: 'black' },
};

// Returns e.g. ` design="gray"` for a valid non-default variant, else '' (the
// default and any unrecognized value are omitted to keep the HTML clean).
function variantAttr(type, el) {
  const v = STICKER_VARIANTS[type];
  if (!v) return '';
  const raw = el[v.attr];
  if (!raw || raw === v.def || !v.allowed.includes(raw)) return '';
  return ` ${v.attr}="${raw}"`;
}

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

// Is THIS element an emittable Storrito-only interactive sticker? Mirrors the
// exact emission conditions in buildInstaStoryHtml: a link needs a non-empty
// url, a hashtag a tag, a poll a question, a location a location string. A blank
// link (url === '') does NOT count. `mention` is excluded by STORRITO_ONLY_TYPES
// (the Graph path tags it for free), so it never counts here.
function isEmittableStorritoSticker(el) {
  if (!el || !STORRITO_ONLY_TYPES.has(el.type)) return false;
  if (el.type === 'link') return !!el.url;
  if (el.type === 'hashtag') return !!el.tag;
  if (el.type === 'poll') return !!el.question;
  if (el.type === 'location') return !!el.location;
  return false;
}

// Count the actually-emittable Storrito-only stickers in a layout — the
// authoritative "is this worth a Storrito call?" measure shared by the routing
// gate (meta.js) and the pre-publish degenerate guard below.
function countStorritoStickers(layout) {
  if (!layout || !Array.isArray(layout.elements)) return 0;
  return layout.elements.filter(isEmittableStorritoSticker).length;
}

/** True when the operator (User) has both a Storrito token and base URL set. */
function isConfigured(user) {
  return !!(user && user.storritoApiToken && user.storritoApiBase);
}

/**
 * Does this story layout contain a POPULATED sticker only Storrito can publish
 * natively (a link/hashtag/poll/location with its required field filled)? A
 * bare/blank sticker (e.g. a link with an empty url, the editor's makeDefault)
 * does NOT count. NOTE: this no longer gates IG routing — every connected IG
 * reshare now goes through Storrito for the tappable repost link. It is used only
 * by stickerGapReason to alert the operator when a story that DID carry such a
 * sticker had to fall back to Graph (which can't render it). Mirrors the exact
 * emission conditions in buildInstaStoryHtml.
 */
function layoutHasNativeStickers(layout) {
  return countStorritoStickers(layout) > 0;
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
 * Translate a Postify story layout into Storrito's `<insta-story>` HTML — a REAL
 * Instagram repost, not a flat picture. The fully rendered 9:16 reshare-look card
 * (the original post's image + author + caption on the background) is passed as
 * `backgroundUrl` and baked in as the base image, then we overlay the NATIVE,
 * TAPPABLE stickers that make it a genuine repost:
 *   • the REPOST LINK — an <insta-link> pointing at the just-published post's
 *     permalink (`repostUrl`), so a viewer can tap the reshare to open the
 *     original post, exactly like Instagram's "add post to your story". This is
 *     ALWAYS emitted when a permalink is known — it's what turns a baked card
 *     into a linked repost instead of a dead picture.
 *   • the self-@mention — a tappable <insta-mention> for the resharing account.
 *   • any extra interactive stickers from the layout (link/hashtag/poll/location).
 * Element coords are normalized 0–1 and mapped to absolute pixels on the
 * 1080x1920 canvas, centered on the point. Sticker data lives in component
 * ATTRIBUTES (not text content):
 *   <insta-link url text> · <insta-hashtag hashtag> · <insta-mention username>
 *   <insta-poll question options(JSON)> · <insta-location location location-id>
 */
function buildInstaStoryHtml({ backgroundUrl, backgroundVideoUrl, layout, fallbackMentionUsername, repostUrl, repostLabel }) {
  const { width, height } = STORY_DIMENSIONS;
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const px = (v, span) => `${Math.round(clamp01(v) * span)}px`;
  const at = (el) => `position:absolute;left:${px(el.x, width)};top:${px(el.y, height)};transform:translate(-50%,-50%)`;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const stickers = [];

  // THE REPOST LINK — what makes this a tappable, linked repost rather than a
  // flat baked picture. Anchored just below the reshared post card (or canvas
  // center when no `post` element is present). Only http(s) permalinks are
  // accepted (SSRF/junk guard); the emoji + label read as a native CTA sticker.
  if (repostUrl && /^https?:\/\//i.test(repostUrl)) {
    const postEl = (layout?.elements || []).find((e) => e && e.type === 'post');
    const rx = postEl ? clamp01(postEl.x ?? 0.5) : 0.5;
    const ry = postEl ? clamp01((postEl.y ?? 0.42) + 0.26) : 0.66;
    const label = repostLabel || '👉 View original post';
    stickers.push(`<insta-link style="${at({ x: rx, y: ry })}" url="${esc(repostUrl)}" text="${esc(label)}"></insta-link>`);
  }

  for (const el of (layout?.elements || [])) {
    if (!el) continue;
    if (el.type === 'link' && el.url) {
      const label = el.text || el.label; // editor stores the label in `text`
      const text = label ? ` text="${esc(label)}"` : '';
      stickers.push(`<insta-link style="${at(el)}" url="${esc(el.url)}"${text}${variantAttr('link', el)}></insta-link>`);
    } else if (el.type === 'hashtag' && el.tag) {
      stickers.push(`<insta-hashtag style="${at(el)}" hashtag="${esc(String(el.tag).replace(/^#/, ''))}"${variantAttr('hashtag', el)}></insta-hashtag>`);
    } else if (el.type === 'poll' && el.question) {
      const opts = (Array.isArray(el.options) && el.options.length >= 2 ? el.options : ['Yes', 'No'])
        .slice(0, 4).map((o) => String(o));
      stickers.push(`<insta-poll style="${at(el)}" question="${esc(el.question)}" options="${esc(JSON.stringify(opts))}"${variantAttr('poll', el)}></insta-poll>`);
    } else if (el.type === 'mention' && (el.username || fallbackMentionUsername)) {
      stickers.push(`<insta-mention style="${at(el)}" username="${esc((el.username || fallbackMentionUsername).replace(/^@/, ''))}"${variantAttr('mention', el)}></insta-mention>`);
    } else if (el.type === 'location' && el.location) {
      const locId = el.locationId ? ` location-id="${esc(el.locationId)}"` : '';
      stickers.push(`<insta-location style="${at(el)}" location="${esc(el.location)}"${locId}${variantAttr('location', el)}></insta-location>`);
    }
  }

  // A VIDEO story puts the clip on the <insta-story src> attribute (confirmed:
  // "If the <insta-story> element has a src pointing to a video, a video story is
  // created"). The reshare-look CARD is already baked INTO that video by the
  // compositor (card chrome behind a video-filled slot), so we add no <img>. A
  // PHOTO story keeps the rendered card as a full-bleed <img> background. Either
  // way the interactive stickers overlay on top and stay native/tappable.
  const open = backgroundVideoUrl
    ? `<insta-story src="${esc(backgroundVideoUrl)}">`
    : '<insta-story>';
  const background = backgroundVideoUrl
    ? []
    : [`  <img src="${esc(backgroundUrl)}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover" />`];

  return [
    open,
    ...background,
    ...stickers.map((s) => `  ${s}`),
    '</insta-story>',
  ].join('\n');
}

/**
 * Publish (or immediately schedule) one sticker story to a connected IG account.
 *
 * @param {object}  user                operator with Storrito creds
 * @param {string}  instagramUsername   the Storrito-connected handle for this client
 * @param {string}  [backgroundUrl]     absolute URL to the rendered 9:16 card
 *                                      (PHOTO stories) — the <img> background
 * @param {string}  [backgroundVideoUrl] absolute URL to the composited card+video
 *                                      MP4 (VIDEO stories) — the <insta-story src>.
 *                                      Provide exactly one of these two.
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
 *
 * @param {string} [repostUrl]  permalink of the just-published feed post — emitted
 *        as the tappable repost-link sticker so the story is a real linked repost.
 */
async function publishStickerStory({ user, instagramUsername, backgroundUrl, backgroundVideoUrl, layout, fallbackMentionUsername, repostUrl, repostLabel, storyPostUuid }) {
  const http = clientFor(user);
  const html = buildInstaStoryHtml({ backgroundUrl, backgroundVideoUrl, layout, fallbackMentionUsername, repostUrl, repostLabel });
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
  STICKER_VARIANTS,
  isConfigured,
  isEmittableStorritoSticker,
  countStorritoStickers,
  layoutHasNativeStickers,
  stickerGapReason,
  listInstagramUsers,
  buildInstaStoryHtml,
  publishStickerStory,
  cancelStory,
  getStoryStatus,
};
