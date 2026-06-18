const axios = require('axios');
const crypto = require('crypto');
const { readToken, decrypt } = require('../utils/encryption');
const { renderStoryToFile, renderStoryCardForVideo } = require('./storyRenderer');
const { ensureIgImage, ensureJpeg, ensureStoryImage, compositeVideoStory, probeMedia } = require('./mediaProcessor');
const storritoSvc = require('./storrito');

// v18.0 reached end-of-life; v22.0 is current and within Meta's support window.
// Endpoint shapes used here are unchanged across these versions.
const GRAPH = 'https://graph.facebook.com/v22.0';

// Every Graph call goes through this wrapper so a stalled socket can never wedge
// a post in "posting" forever (axios has no default timeout). 60s comfortably
// covers a single Graph request; long operations (video processing) poll instead.
// It delegates to axios.* (rather than axios.create) so the default timeout is
// applied without changing how callers/tests observe the underlying calls.
const REQUEST_TIMEOUT_MS = 60000;
const http = {
  get: (url, config = {}) => axios.get(url, { timeout: REQUEST_TIMEOUT_MS, ...config }),
  post: (url, data, config = {}) => axios.post(url, data, { timeout: REQUEST_TIMEOUT_MS, ...config }),
  delete: (url, config = {}) => axios.delete(url, { timeout: REQUEST_TIMEOUT_MS, ...config }),
};

// Graph requires an appsecret_proof (HMAC of the token with the app secret) on
// server-side calls when the app has "Require App Secret" enabled.
function appSecretProof(accessToken, appSecret) {
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

// Add appsecret_proof to a params object when an app secret is available, keyed
// to the access_token in those same params. A no-op without a secret/token, so
// publishing still works when "Require App Secret" is off (the default).
function withProof(params, appSecret) {
  if (appSecret && params && params.access_token) {
    return { ...params, appsecret_proof: appSecretProof(params.access_token, appSecret) };
  }
  return params;
}

function formatPlaceAddress(loc = {}) {
  return [loc.street, loc.city, loc.state, loc.country].filter(Boolean).join(', ');
}

// Append a post's link to its caption on its own line. Idempotent — won't
// duplicate a link already present in the caption. Meta exposes no separate
// link field on feed posts, so the URL must live in the caption text
// (clickable on Facebook, plain text on Instagram).
function appendCaptionLink(caption, link) {
  const url = (link || '').trim();
  const text = caption || '';
  if (!url || text.includes(url)) return text;
  return text ? `${text}\n\n${url}` : url;
}

// Pull the most specific message out of a failed Graph API call so callers can
// surface the real reason (e.g. a missing capability) instead of a generic one.
function graphErrorMessage(err) {
  return err?.response?.data?.error?.message || err?.message || 'Unknown error';
}

// Typeahead search for taggable places. /pages/search is the only supported
// place search since the dedicated Places Search API was deprecated (2020); it
// returns Facebook Place Pages whose IDs work as both the Instagram location_id
// and the Facebook `place` tag.
async function searchPlaces(query, accessToken, appSecret) {
  const { data } = await http.get(`${GRAPH}/pages/search`, {
    params: {
      q: query,
      fields: 'id,name,location,link',
      access_token: accessToken,
      appsecret_proof: appSecretProof(accessToken, appSecret),
      limit: 10,
    },
  });
  // Keep only results that resolve to a physical place (have a location).
  const raw = data.data || [];
  const places = raw
    .filter(p => p.location && (p.location.city || p.location.country || p.location.street))
    .map(p => ({ id: p.id, name: p.name, address: formatPlaceAddress(p.location) }));
  return places;
}

// Default reshare-look story layouts — mirror the client StoryEditor defaults
// (defaultLayout / defaultLayoutFb) so a post with NO saved layout still
// publishes the CARD with the media inside, matching the native phone "add post
// to your story". IG adds a tappable @mention; FB omits it (no FB mention
// sticker). Kept in sync with client/src/components/StoryEditor.jsx.
function defaultIgStoryLayout() {
  return {
    version: 1,
    background: { type: 'gradient', value: 'linear-gradient(160deg,#f7971e,#ffd200)' },
    elements: [
      { id: 'post', type: 'post', x: 0.5, y: 0.42, width: 0.72, rotation: 0 },
      { id: 'mention', type: 'mention', x: 0.5, y: 0.78, rotation: 0, scale: 1 },
    ],
  };
}
function defaultFbStoryLayout() {
  return {
    version: 1,
    background: { type: 'gradient', value: 'linear-gradient(160deg,#f7971e,#ffd200)' },
    elements: [
      { id: 'post', type: 'post', x: 0.5, y: 0.42, width: 0.72, rotation: 0 },
    ],
  };
}
// A saved layout wins; an empty/null one falls back to the platform default card.
function effectiveStoryLayout(saved, isIg) {
  if (saved && Array.isArray(saved.elements) && saved.elements.length > 0) return saved;
  return isIg ? defaultIgStoryLayout() : defaultFbStoryLayout();
}

async function publishPost(post, tokens, appCreds, serverUrl, opts = {}) {
  // Persist each platform's result the moment it's known (best-effort), so a
  // crash or DB hiccup AFTER a platform published doesn't cause a republish on
  // retry — `onResult(platform, result)` is supplied by the worker.
  const onResult = typeof opts.onResult === 'function' ? opts.onResult : null;
  // Decrypt the app secret once for appsecret_proof. Null when not configured
  // (or in tests), in which case proofs are simply omitted.
  const appSecret = appCreds && appCreds.metaAppSecret ? decrypt(appCreds.metaAppSecret) : null;

  // Carry forward any results from a previous attempt so we can skip a platform
  // that already published (idempotent retry — prevents duplicate live posts).
  const results = {
    instagramResult: post.instagramResult || null,
    facebookResult: post.facebookResult || null,
  };
  const igDone = !!(post.instagramResult && post.instagramResult.feed && post.instagramResult.feed.mediaId && !post.instagramResult.error);
  const fbDone = !!(post.facebookResult && post.facebookResult.feed && post.facebookResult.feed.postId && !post.facebookResult.error);

  const igToken = tokens.find(t => t.platform === 'instagram');
  const fbToken = tokens.find(t => t.platform === 'facebook');

  // Resolve the connected IG identity once — used both for the rendered story
  // card and for the @mention user_tag.
  let igProfile = null;
  if (igToken && igToken.instagramAccountId && !igDone) {
    igProfile = await getIgProfile(igToken.instagramAccountId, readToken(igToken.accessToken), appSecret).catch(() => null);
  }

  const isVideoPost = post.mediaType === 'video';
  const displayName = post.client?.businessName || post.client?.name || igProfile?.name || igProfile?.username || '';

  // Build the story creative for ONE platform from ITS OWN layout, so Instagram
  // and Facebook stories are fully independent (item #7) — editing one never
  // bleeds into the other. A saved layout becomes the reshare-look card; with no
  // layout the media is posted centered (item #4). Best-effort: any failure
  // degrades to the plain media so a story still goes out.
  //   returns { image } | { video } | null
  async function buildStory(layout, { withMention }) {
    if (!post.postToStory || !Array.isArray(post.mediaUrls) || !post.mediaUrls.length) return null;
    const hasCard = layout && Array.isArray(layout.elements) && layout.elements.length > 0;
    const username = withMention ? (igProfile?.username || '') : '';
    try {
      if (isVideoPost) {
        if (hasCard) {
          // Reshare-look card with the video playing inside the slot (item #5).
          const m = await probeMedia(post.mediaUrls[0]);
          const card = await renderStoryCardForVideo({
            layout, caption: post.caption, displayName, username,
            avatarUrl: igProfile?.avatarUrl || null,
            videoAspect: m && m.width && m.height ? m.height / m.width : 0.82,
          });
          if (card && card.rect) {
            const url = await compositeVideoStory({ cardAbsPath: card.pngPath, rect: card.rect, videoUrl: post.mediaUrls[0] });
            if (url) return { video: url, mention: card.mention };
            console.warn(`Story ${post.id}: video card composite failed (ffmpeg returned null) — posting raw clip`);
          } else {
            console.warn(`Story ${post.id}: could not locate card video slot (rect=${card && card.rect}) — posting raw clip`);
          }
        } else {
          console.warn(`Story ${post.id}: video post has no reshare-card layout — posting raw clip`);
        }
        return { video: post.mediaUrls[0] };           // raw video fallback
      }
      if (hasCard) {
        const r = await renderStoryToFile({
          layout, mediaType: post.mediaType, mediaUrls: post.mediaUrls,
          caption: post.caption, displayName, username,
          avatarUrl: igProfile?.avatarUrl || null,
        });
        return { image: r.url, mention: r.mention };
      }
      return { image: await ensureStoryImage(post.mediaUrls[0]) }; // centered photo
    } catch (err) {
      console.warn(`Story build failed for post ${post.id} (${withMention ? 'ig' : 'fb'}): ${err.message}`);
      return isVideoPost ? { video: post.mediaUrls[0] } : { image: post.mediaUrls[0] };
    }
  }

  // Resolve each platform's effective layout once (saved → else default card),
  // so the rendered creative AND the Storrito sticker HTML use the very same
  // layout — no drift between what's baked into the image/video and the tappable
  // stickers Storrito overlays.
  const igStoryLayout = effectiveStoryLayout(post.storyLayout, true);
  const fbStoryLayout = effectiveStoryLayout(post.storyLayoutFb, false);

  const igStory = igToken && igToken.instagramAccountId && !igDone ? await buildStory(igStoryLayout, { withMention: true }) : null;
  const fbStory = fbToken && fbToken.pageId && !fbDone ? await buildStory(fbStoryLayout, { withMention: false }) : null;

  // Feed posts carry the optional link in the caption text (Meta has no separate
  // link field). Story creatives are rendered from the ORIGINAL caption above, so
  // the raw URL never clutters the reshare-look card.
  const feedCaption = appendCaptionLink(post.caption, post.link);
  const feedPost = feedCaption === post.caption ? post : { ...post, caption: feedCaption };

  // Route THIS client's IG story through Storrito whenever the operator has creds
  // and the client is connected — Storrito publishes the reshare-look card (baked
  // into the story image/video) WITH native, tappable stickers, matching the
  // phone "add post to your story" experience far better than the Graph path.
  // Previously this ALSO required a link/poll/hashtag/location sticker, which
  // excluded plain reshare cards (card + @mention) — exactly what users post — so
  // those silently fell back to Graph and "never used Storrito". Anything missing
  // → Graph, so the no-creds default is unchanged, and Graph remains the runtime
  // fallback if a Storrito call fails.
  const client = post.client || {};
  const storritoStory = (
    storritoSvc.isConfigured(appCreds) &&
    client.usesStories &&
    client.storritoUsername
  ) ? { user: appCreds, instagramUsername: client.storritoUsername, layout: igStoryLayout } : null;

  if (igToken && igToken.instagramAccountId && !igDone) {
    try {
      results.instagramResult = await publishToInstagram({
        igUserId: igToken.instagramAccountId,
        accessToken: readToken(igToken.accessToken),
        appSecret,
        post: feedPost,
        serverUrl,
        story: igStory,
        igProfile,
        storrito: storritoStory,
      });
    } catch (err) {
      results.instagramResult = { error: err.response?.data || err.message };
    }
    if (onResult) await onResult('instagram', results.instagramResult);
  }

  if (fbToken && fbToken.pageId && !fbDone) {
    try {
      results.facebookResult = await publishToFacebook({
        pageId: fbToken.pageId,
        accessToken: readToken(fbToken.accessToken),
        appSecret,
        post: feedPost,
        serverUrl,
        story: fbStory,
      });
    } catch (err) {
      results.facebookResult = { error: err.response?.data || err.message };
    }
    if (onResult) await onResult('facebook', results.facebookResult);
  }

  return results;
}

async function publishToInstagram({ igUserId, accessToken, appSecret, post, serverUrl, story, igProfile, storrito }) {
  const { mediaType, mediaUrls, caption, postToStory, locationId, thumbOffset } = post;
  const feedResult = await publishIgFeed({
    igUserId, accessToken, appSecret, mediaType, mediaUrls, caption, serverUrl, locationId, thumbOffset,
  });

  const graphStory = () => publishIgStory({
    igUserId, accessToken, appSecret, story, serverUrl, username: igProfile?.username || null,
  });

  let storyResult = null;
  if (postToStory && story) {
    // Storrito takes a PHOTO story as a flat <img> background (the rendered card)
    // and a VIDEO story via the <insta-story src> attribute (the composited
    // card+video MP4 built upstream). Either way the reshare-look card is already
    // baked into the media, so Storrito just overlays the native tappable stickers.
    const useStorrito = storrito && (story.image || story.video);
    try {
      if (useStorrito) {
        const r = await storritoSvc.publishStickerStory({
          user: storrito.user,
          instagramUsername: storrito.instagramUsername,
          backgroundUrl: story.image ? `${serverUrl}${story.image}` : undefined,
          backgroundVideoUrl: story.video ? `${serverUrl}${story.video}` : undefined,
          layout: storrito.layout,
          fallbackMentionUsername: igProfile?.username || null,
        });
        storyResult = { via: 'storrito', ...r };
      } else {
        storyResult = await graphStory();
      }
    } catch (err) {
      // If Storrito fails (misconfig, outage, stale schema), don't drop the story
      // — fall back to the Graph version so something still goes live.
      if (useStorrito) {
        console.warn(`Storrito story failed for IG ${igUserId}, falling back to Graph: ${err.message}`);
        try {
          storyResult = { via: 'graph-fallback', ...(await graphStory()) };
        } catch (err2) {
          storyResult = { error: err2.response?.data || err2.message };
        }
      } else {
        storyResult = { error: err.response?.data || err.message };
      }
    }
  }

  return { feed: feedResult, story: storyResult };
}

async function publishIgFeed({ igUserId, accessToken, appSecret, mediaType, mediaUrls, caption, serverUrl, locationId, thumbOffset }) {
  let creationId;

  if (mediaType === 'carousel') {
    // Normalize every slide to a spec-safe JPEG first — IG silently rejects
    // non-JPEG / out-of-aspect children, which is why image posts never appeared.
    const igUrls = await Promise.all(mediaUrls.map(ensureIgImage));
    const childIds = await Promise.all(
      igUrls.map(url =>
        http.post(`${GRAPH}/${igUserId}/media`, withProof({
          image_url: `${serverUrl}${url}`,
          is_carousel_item: true,
          access_token: accessToken,
        }, appSecret)).then(r => r.data.id)
      )
    );

    const params = {
      media_type: 'CAROUSEL',
      children: childIds,
      caption,
      access_token: accessToken,
    };
    if (locationId) params.location_id = locationId;

    const { data } = await http.post(`${GRAPH}/${igUserId}/media`, withProof(params, appSecret));
    creationId = data.id;
    // Wait for the container to finish before publishing — without this a
    // not-yet-ready container can fail or publish empty.
    await waitForContainer(creationId, accessToken, appSecret);
  } else if (mediaType === 'video') {
    const params = {
      media_type: 'REELS',
      video_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    };
    if (locationId) params.location_id = locationId;
    if (thumbOffset != null) params.thumb_offset = thumbOffset;

    const { data } = await http.post(`${GRAPH}/${igUserId}/media`, withProof(params, appSecret));
    creationId = data.id;
    await waitForContainer(creationId, accessToken, appSecret);
  } else {
    // Guarantee a JPEG within IG's allowed aspect range; non-JPEG/odd-aspect
    // images are the reason single photos never showed up on Instagram.
    const igUrl = await ensureIgImage(mediaUrls[0]);
    const params = {
      image_url: `${serverUrl}${igUrl}`,
      caption,
      access_token: accessToken,
    };
    if (locationId) params.location_id = locationId;

    const { data } = await http.post(`${GRAPH}/${igUserId}/media`, withProof(params, appSecret));
    creationId = data.id;
    await waitForContainer(creationId, accessToken, appSecret);
  }

  const { data } = await http.post(`${GRAPH}/${igUserId}/media_publish`, withProof({
    creation_id: creationId,
    access_token: accessToken,
  }, appSecret));

  // Capture the public permalink so the dashboard can link to the live post
  let permalink = null;
  try {
    const { data: info } = await http.get(`${GRAPH}/${data.id}`, {
      params: withProof({ fields: 'permalink', access_token: accessToken }, appSecret),
    });
    permalink = info.permalink || null;
  } catch (_) { /* permalink is best-effort */ }

  return { mediaId: data.id, creationId, permalink };
}

async function publishIgStory({ igUserId, accessToken, appSecret, story, serverUrl, username }) {
  const isVideo = !!story.video;
  // Stories require media_type=STORIES. Image stories must be JPEG (the rendered
  // card is a PNG), so convert best-effort or the story silently fails to appear.
  const params = { media_type: 'STORIES', access_token: accessToken };
  if (isVideo) {
    params.video_url = `${serverUrl}${story.video}`;
  } else {
    const img = await ensureJpeg(story.image);
    params.image_url = `${serverUrl}${img}`;
  }

  // A self-mention is the only interactive element Graph exposes on stories
  // (user_tags, added 2025-07-09) — link stickers are not available via the API.
  // Honor the editor's intent:
  //   • mention element present → tag at its coords (story.mention = {x,y})
  //   • mention element removed from a custom layout → story.mention === null,
  //     so add NO tag (the user explicitly deleted it)
  //   • no custom layout at all → no `mention` key, so keep the default
  //     bottom-center self-tag (plain reshare behaviour)
  if (username) {
    if (story.mention) {
      params.user_tags = [{ username, x: story.mention.x, y: story.mention.y }];
    } else if (!('mention' in story)) {
      params.user_tags = [{ username, x: 0.5, y: 0.92 }];
    }
  }

  const { data: container } = await http.post(`${GRAPH}/${igUserId}/media`, withProof(params, appSecret));
  // Wait for the container to finish for images too, not just video: Meta has to
  // download image_url from our server, and publishing a not-yet-ready container
  // can fail or post an empty story.
  await waitForContainer(container.id, accessToken, appSecret);
  const { data } = await http.post(`${GRAPH}/${igUserId}/media_publish`, withProof({
    creation_id: container.id,
    access_token: accessToken,
  }, appSecret));
  return { mediaId: data.id };
}

// Look up the connected account's username, display name, and avatar — used for
// the rendered story card and the @mention. Best-effort.
async function getIgProfile(igUserId, accessToken, appSecret) {
  try {
    const { data } = await http.get(`${GRAPH}/${igUserId}`, {
      params: withProof({ fields: 'username,name,profile_picture_url', access_token: accessToken }, appSecret),
    });
    return { username: data.username || null, name: data.name || null, avatarUrl: data.profile_picture_url || null };
  } catch (_) {
    return null;
  }
}

async function publishToFacebook({ pageId, accessToken, appSecret, post, serverUrl, story }) {
  const { mediaType, mediaUrls, caption, postToStory, locationId } = post;
  let feedResult;

  // Every branch returns its FB object id under `postId` (a Page video, photo,
  // and feed post are all deletable via DELETE /{id}). Keeping one canonical key
  // is what lets unpost actually delete the post — earlier the video/single-photo
  // branches used videoId/photoId, which the unpost path never checked, so those
  // posts were never removed.
  if (mediaType === 'video') {
    const params = {
      file_url: `${serverUrl}${mediaUrls[0]}`,
      description: caption,
      access_token: accessToken,
    };
    if (locationId) params.place = locationId;

    const { data } = await http.post(`${GRAPH}/${pageId}/videos`, withProof(params, appSecret));
    feedResult = { postId: data.id, permalink: `https://www.facebook.com/${data.id}` };
    if (data.id) await likeFbPost(data.id, accessToken, appSecret).catch(() => {});
  } else if (mediaUrls.length > 1) {
    const photoIds = await Promise.all(
      mediaUrls.map(url =>
        http.post(`${GRAPH}/${pageId}/photos`, withProof({
          url: `${serverUrl}${url}`,
          published: false,
          access_token: accessToken,
        }, appSecret)).then(r => ({ media_fbid: r.data.id }))
      )
    );

    const params = { message: caption, attached_media: photoIds, access_token: accessToken };
    if (locationId) params.place = locationId;

    const { data } = await http.post(`${GRAPH}/${pageId}/feed`, withProof(params, appSecret));
    feedResult = { postId: data.id, permalink: `https://www.facebook.com/${data.id}` };
    if (data.id) await likeFbPost(data.id, accessToken, appSecret).catch(() => {});
  } else {
    const params = { url: `${serverUrl}${mediaUrls[0]}`, message: caption, access_token: accessToken };
    if (locationId) params.place = locationId;

    const { data } = await http.post(`${GRAPH}/${pageId}/photos`, withProof(params, appSecret));
    feedResult = { postId: data.id, permalink: `https://www.facebook.com/${data.id}` };
    if (data.id) await likeFbPost(data.id, accessToken, appSecret).catch(() => {});
  }

  // Share to the Facebook story using FACEBOOK's own creative (item #7) — the
  // FB story is built from post.storyLayoutFb upstream, never from IG's layout.
  let storyResult = null;
  if (postToStory && story) {
    storyResult = await publishFbStory({ pageId, accessToken, appSecret, story, serverUrl });
  }

  return storyResult ? { feed: feedResult, story: storyResult } : { feed: feedResult };
}

async function publishFbStory({ pageId, accessToken, appSecret, story, serverUrl }) {
  try {
    if (story.video) {
      // Facebook video stories require a 3-phase upload: start → upload the
      // hosted file → finish. A single finish call with file_url does nothing.
      const { data: start } = await http.post(`${GRAPH}/${pageId}/video_stories`, withProof({
        upload_phase: 'start',
        access_token: accessToken,
      }, appSecret));
      const videoId = start.video_id;

      // Phase 2: hand Meta the public URL to fetch (resumable upload endpoint).
      await http.post(start.upload_url, null, {
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_url: `${serverUrl}${story.video}`,
        },
      });

      // Wait for Meta to finish downloading/processing before publishing.
      await waitForFbVideoStory(videoId, accessToken, appSecret);

      const { data } = await http.post(`${GRAPH}/${pageId}/video_stories`, withProof({
        upload_phase: 'finish',
        video_id: videoId,
        access_token: accessToken,
      }, appSecret));
      return { storyId: data.post_id || videoId };
    }

    // Photo story: upload unpublished, then share to story.
    const { data: photo } = await http.post(`${GRAPH}/${pageId}/photos`, withProof({
      url: `${serverUrl}${story.image}`,
      published: false,
      access_token: accessToken,
    }, appSecret));
    const { data } = await http.post(`${GRAPH}/${pageId}/photo_stories`, withProof({
      photo_id: photo.id,
      access_token: accessToken,
    }, appSecret));
    return { storyId: data.post_id || data.id };
  } catch (err) {
    return { error: err.response?.data || err.message };
  }
}

async function likeFbPost(postId, accessToken, appSecret) {
  await http.post(`${GRAPH}/${postId}/likes`, withProof({ access_token: accessToken }, appSecret));
}

async function waitForContainer(containerId, accessToken, appSecret, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await http.get(`${GRAPH}/${containerId}`, {
      params: withProof({ fields: 'status_code', access_token: accessToken }, appSecret),
    });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error('Media container processing failed');
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('Media container timed out');
}

// Poll a Facebook video-story upload until Meta has fetched and processed the
// file, so the finish phase doesn't publish an empty/half-uploaded story.
async function waitForFbVideoStory(videoId, accessToken, appSecret, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await http.get(`${GRAPH}/${videoId}`, {
      params: withProof({ fields: 'status', access_token: accessToken }, appSecret),
    });
    const uploading = data.status?.uploading_phase?.status;
    const processing = data.status?.processing_phase?.status;
    if (uploading === 'error' || processing === 'error') {
      throw new Error('Facebook video story processing failed');
    }
    if (uploading === 'complete' && (!processing || processing === 'complete')) return;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Facebook video story timed out');
}

async function getLongLivedToken(shortToken, appId, appSecret) {
  const { data } = await http.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
  });
  return data;
}

async function getPagesAndIgAccounts(userToken) {
  // Follow pagination — /me/accounts returns 25 Pages per page by default, so an
  // agency user managing more than 25 Pages would otherwise never see the rest.
  const pages = [];
  let url = `${GRAPH}/me/accounts`;
  let params = { access_token: userToken, fields: 'id,name,access_token,instagram_business_account', limit: 100 };
  for (let i = 0; i < 50 && url; i++) { // hard cap at 50 pages (5000 Pages) as a runaway guard
    const { data } = await http.get(url, { params });
    if (Array.isArray(data.data)) pages.push(...data.data);
    url = data.paging && data.paging.next ? data.paging.next : null;
    params = undefined; // the `next` URL already carries all query params
  }
  return pages;
}

async function deleteIgPost(mediaId, accessToken) {
  await http.delete(`${GRAPH}/${mediaId}`, { params: { access_token: accessToken } });
}

async function deleteFbPost(postId, accessToken) {
  await http.delete(`${GRAPH}/${postId}`, { params: { access_token: accessToken } });
}

module.exports = {
  publishPost,
  getLongLivedToken,
  getPagesAndIgAccounts,
  getIgProfile,
  searchPlaces,
  graphErrorMessage,
  appendCaptionLink,
  deleteIgPost,
  deleteFbPost,
};
