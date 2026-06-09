const axios = require('axios');
const crypto = require('crypto');
const { readToken } = require('../utils/encryption');
const { renderStoryToFile, renderStoryCardForVideo } = require('./storyRenderer');
const { ensureIgImage, ensureJpeg, ensureStoryImage, compositeVideoStory, probeMedia } = require('./mediaProcessor');

// v18.0 reached end-of-life; v22.0 is current and within Meta's support window.
// Endpoint shapes used here are unchanged across these versions.
const GRAPH = 'https://graph.facebook.com/v22.0';

// Graph requires an appsecret_proof (HMAC of the token with the app secret) on
// server-side calls when the app has "Require App Secret" enabled.
function appSecretProof(accessToken, appSecret) {
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
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
  const { data } = await axios.get(`${GRAPH}/pages/search`, {
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

async function publishPost(post, tokens, appCreds, serverUrl) {
  const results = { instagramResult: null, facebookResult: null };

  const igToken = tokens.find(t => t.platform === 'instagram');
  const fbToken = tokens.find(t => t.platform === 'facebook');

  // Resolve the connected IG identity once — used both for the rendered story
  // card and for the @mention user_tag.
  let igProfile = null;
  if (igToken && igToken.instagramAccountId) {
    igProfile = await getIgProfile(igToken.instagramAccountId, readToken(igToken.accessToken)).catch(() => null);
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
          }
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

  const igStory = igToken && igToken.instagramAccountId ? await buildStory(post.storyLayout, { withMention: true }) : null;
  const fbStory = fbToken && fbToken.pageId ? await buildStory(post.storyLayoutFb, { withMention: false }) : null;

  // Feed posts carry the optional link in the caption text (Meta has no separate
  // link field). Story creatives are rendered from the ORIGINAL caption above, so
  // the raw URL never clutters the reshare-look card.
  const feedCaption = appendCaptionLink(post.caption, post.link);
  const feedPost = feedCaption === post.caption ? post : { ...post, caption: feedCaption };

  if (igToken && igToken.instagramAccountId) {
    try {
      results.instagramResult = await publishToInstagram({
        igUserId: igToken.instagramAccountId,
        accessToken: readToken(igToken.accessToken),
        post: feedPost,
        serverUrl,
        story: igStory,
        igProfile,
      });
    } catch (err) {
      results.instagramResult = { error: err.response?.data || err.message };
    }
  }

  if (fbToken && fbToken.pageId) {
    try {
      results.facebookResult = await publishToFacebook({
        pageId: fbToken.pageId,
        accessToken: readToken(fbToken.accessToken),
        post: feedPost,
        serverUrl,
        story: fbStory,
      });
    } catch (err) {
      results.facebookResult = { error: err.response?.data || err.message };
    }
  }

  return results;
}

async function publishToInstagram({ igUserId, accessToken, post, serverUrl, story, igProfile }) {
  const { mediaType, mediaUrls, caption, postToStory, locationId, thumbOffset } = post;
  const feedResult = await publishIgFeed({
    igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl, locationId, thumbOffset,
  });

  let storyResult = null;
  if (postToStory && story) {
    try {
      storyResult = await publishIgStory({
        igUserId, accessToken, story, serverUrl, username: igProfile?.username || null,
      });
    } catch (err) {
      storyResult = { error: err.response?.data || err.message };
    }
  }

  return { feed: feedResult, story: storyResult };
}

async function publishIgFeed({ igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl, locationId, thumbOffset }) {
  let creationId;

  if (mediaType === 'carousel') {
    // Normalize every slide to a spec-safe JPEG first — IG silently rejects
    // non-JPEG / out-of-aspect children, which is why image posts never appeared.
    const igUrls = await Promise.all(mediaUrls.map(ensureIgImage));
    const childIds = await Promise.all(
      igUrls.map(url =>
        axios.post(`${GRAPH}/${igUserId}/media`, {
          image_url: `${serverUrl}${url}`,
          is_carousel_item: true,
          access_token: accessToken,
        }).then(r => r.data.id)
      )
    );

    const params = {
      media_type: 'CAROUSEL',
      children: childIds,
      caption,
      access_token: accessToken,
    };
    if (locationId) params.location_id = locationId;

    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, params);
    creationId = data.id;
    // Wait for the container to finish before publishing — without this a
    // not-yet-ready container can fail or publish empty.
    await waitForContainer(creationId, accessToken);
  } else if (mediaType === 'video') {
    const params = {
      media_type: 'REELS',
      video_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    };
    if (locationId) params.location_id = locationId;
    if (thumbOffset != null) params.thumb_offset = thumbOffset;

    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, params);
    creationId = data.id;
    await waitForContainer(creationId, accessToken);
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

    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, params);
    creationId = data.id;
    await waitForContainer(creationId, accessToken);
  }

  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });

  // Capture the public permalink so the dashboard can link to the live post
  let permalink = null;
  try {
    const { data: info } = await axios.get(`${GRAPH}/${data.id}`, {
      params: { fields: 'permalink', access_token: accessToken },
    });
    permalink = info.permalink || null;
  } catch (_) { /* permalink is best-effort */ }

  return { mediaId: data.id, creationId, permalink };
}

async function publishIgStory({ igUserId, accessToken, story, serverUrl, username }) {
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
  // Place it at the editor's mention coords when present, else bottom-center.
  if (username) {
    const at = story.mention || { x: 0.5, y: 0.92 };
    params.user_tags = [{ username, x: at.x, y: at.y }];
  }

  const { data: container } = await axios.post(`${GRAPH}/${igUserId}/media`, params);
  if (isVideo) await waitForContainer(container.id, accessToken);
  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return { mediaId: data.id };
}

// Look up the connected account's username, display name, and avatar — used for
// the rendered story card and the @mention. Best-effort.
async function getIgProfile(igUserId, accessToken) {
  try {
    const { data } = await axios.get(`${GRAPH}/${igUserId}`, {
      params: { fields: 'username,name,profile_picture_url', access_token: accessToken },
    });
    return { username: data.username || null, name: data.name || null, avatarUrl: data.profile_picture_url || null };
  } catch (_) {
    return null;
  }
}

async function publishToFacebook({ pageId, accessToken, post, serverUrl, story }) {
  const { mediaType, mediaUrls, caption, postToStory, locationId } = post;
  let feedResult;

  if (mediaType === 'video') {
    const params = {
      file_url: `${serverUrl}${mediaUrls[0]}`,
      description: caption,
      access_token: accessToken,
    };
    if (locationId) params.place = locationId;

    const { data } = await axios.post(`${GRAPH}/${pageId}/videos`, params);
    feedResult = { videoId: data.id, permalink: `https://www.facebook.com/${data.id}` };
    if (data.id) await likeFbPost(data.id, accessToken).catch(() => {});
  } else if (mediaUrls.length > 1) {
    const photoIds = await Promise.all(
      mediaUrls.map(url =>
        axios.post(`${GRAPH}/${pageId}/photos`, {
          url: `${serverUrl}${url}`,
          published: false,
          access_token: accessToken,
        }).then(r => ({ media_fbid: r.data.id }))
      )
    );

    const params = { message: caption, attached_media: photoIds, access_token: accessToken };
    if (locationId) params.place = locationId;

    const { data } = await axios.post(`${GRAPH}/${pageId}/feed`, params);
    feedResult = { postId: data.id, permalink: `https://www.facebook.com/${data.id}` };
    if (data.id) await likeFbPost(data.id, accessToken).catch(() => {});
  } else {
    const params = { url: `${serverUrl}${mediaUrls[0]}`, message: caption, access_token: accessToken };
    if (locationId) params.place = locationId;

    const { data } = await axios.post(`${GRAPH}/${pageId}/photos`, params);
    feedResult = { photoId: data.id, permalink: `https://www.facebook.com/${data.id}` };
    if (data.id) await likeFbPost(data.id, accessToken).catch(() => {});
  }

  // Share to the Facebook story using FACEBOOK's own creative (item #7) — the
  // FB story is built from post.storyLayoutFb upstream, never from IG's layout.
  let storyResult = null;
  if (postToStory && story) {
    storyResult = await publishFbStory({ pageId, accessToken, story, serverUrl });
  }

  return storyResult ? { feed: feedResult, story: storyResult } : { feed: feedResult };
}

async function publishFbStory({ pageId, accessToken, story, serverUrl }) {
  try {
    if (story.video) {
      // Facebook video stories require a 3-phase upload: start → upload the
      // hosted file → finish. A single finish call with file_url does nothing.
      const { data: start } = await axios.post(`${GRAPH}/${pageId}/video_stories`, {
        upload_phase: 'start',
        access_token: accessToken,
      });
      const videoId = start.video_id;

      // Phase 2: hand Meta the public URL to fetch (resumable upload endpoint).
      await axios.post(start.upload_url, null, {
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_url: `${serverUrl}${story.video}`,
        },
      });

      // Wait for Meta to finish downloading/processing before publishing.
      await waitForFbVideoStory(videoId, accessToken);

      const { data } = await axios.post(`${GRAPH}/${pageId}/video_stories`, {
        upload_phase: 'finish',
        video_id: videoId,
        access_token: accessToken,
      });
      return { storyId: data.post_id || videoId };
    }

    // Photo story: upload unpublished, then share to story.
    const { data: photo } = await axios.post(`${GRAPH}/${pageId}/photos`, {
      url: `${serverUrl}${story.image}`,
      published: false,
      access_token: accessToken,
    });
    const { data } = await axios.post(`${GRAPH}/${pageId}/photo_stories`, {
      photo_id: photo.id,
      access_token: accessToken,
    });
    return { storyId: data.post_id || data.id };
  } catch (err) {
    return { error: err.response?.data || err.message };
  }
}

async function likeFbPost(postId, accessToken) {
  await axios.post(`${GRAPH}/${postId}/likes`, { access_token: accessToken });
}

async function waitForContainer(containerId, accessToken, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${GRAPH}/${containerId}`, {
      params: { fields: 'status_code', access_token: accessToken },
    });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error('Media container processing failed');
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('Media container timed out');
}

// Poll a Facebook video-story upload until Meta has fetched and processed the
// file, so the finish phase doesn't publish an empty/half-uploaded story.
async function waitForFbVideoStory(videoId, accessToken, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${GRAPH}/${videoId}`, {
      params: { fields: 'status', access_token: accessToken },
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
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
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
  const { data } = await axios.get(`${GRAPH}/me/accounts`, {
    params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account' },
  });
  return data.data || [];
}

async function deleteIgPost(mediaId, accessToken) {
  await axios.delete(`${GRAPH}/${mediaId}`, { params: { access_token: accessToken } });
}

async function deleteFbPost(postId, accessToken) {
  await axios.delete(`${GRAPH}/${postId}`, { params: { access_token: accessToken } });
}

module.exports = {
  publishPost,
  getLongLivedToken,
  getPagesAndIgAccounts,
  searchPlaces,
  graphErrorMessage,
  appendCaptionLink,
  deleteIgPost,
  deleteFbPost,
};
