const axios = require('axios');
const crypto = require('crypto');
const { readToken } = require('../utils/encryption');

const GRAPH = 'https://graph.facebook.com/v18.0';

// Graph requires an appsecret_proof (HMAC of the token with the app secret) on
// server-side calls when the app has "Require App Secret" enabled.
function appSecretProof(accessToken, appSecret) {
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

function formatPlaceAddress(loc = {}) {
  return [loc.street, loc.city, loc.state, loc.country].filter(Boolean).join(', ');
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
  return (data.data || [])
    .filter(p => p.location && (p.location.city || p.location.country || p.location.street))
    .map(p => ({ id: p.id, name: p.name, address: formatPlaceAddress(p.location) }));
}

async function publishPost(post, tokens, appCreds, serverUrl) {
  const results = { instagramResult: null, facebookResult: null };

  const igToken = tokens.find(t => t.platform === 'instagram');
  const fbToken = tokens.find(t => t.platform === 'facebook');

  if (igToken && igToken.instagramAccountId) {
    try {
      results.instagramResult = await publishToInstagram({
        igUserId: igToken.instagramAccountId,
        accessToken: readToken(igToken.accessToken),
        post,
        serverUrl,
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
        post,
        serverUrl,
      });
    } catch (err) {
      results.facebookResult = { error: err.response?.data || err.message };
    }
  }

  return results;
}

async function publishToInstagram({ igUserId, accessToken, post, serverUrl }) {
  const { mediaType, mediaUrls, caption, postToStory, locationId, thumbOffset } = post;
  const feedResult = await publishIgFeed({
    igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl, locationId, thumbOffset,
  });

  let storyResult = null;
  if (postToStory) {
    try {
      storyResult = await publishIgStory({ igUserId, accessToken, mediaType, mediaUrls, serverUrl });
    } catch (err) {
      storyResult = { error: err.response?.data || err.message };
    }
  }

  return { feed: feedResult, story: storyResult };
}

async function publishIgFeed({ igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl, locationId, thumbOffset }) {
  let creationId;

  if (mediaType === 'carousel') {
    const childIds = await Promise.all(
      mediaUrls.map(url =>
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
    const params = {
      image_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    };
    if (locationId) params.location_id = locationId;

    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, params);
    creationId = data.id;
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

async function publishIgStory({ igUserId, accessToken, mediaType, mediaUrls, serverUrl }) {
  const isVideo = mediaType === 'video';
  // Stories require media_type=STORIES. The old `is_story` flag was not a real
  // Graph API param, so the container fell back to a normal (caption-less) feed
  // post — which is what caused the duplicate Instagram post.
  const params = isVideo
    ? { media_type: 'STORIES', video_url: `${serverUrl}${mediaUrls[0]}` }
    : { media_type: 'STORIES', image_url: `${serverUrl}${mediaUrls[0]}` };

  params.access_token = accessToken;

  // Mention the account on the story so viewers can tap through to its profile.
  // This is the only interactive element Graph exposes on stories (user_tags,
  // added 2025-07-09). Link stickers and "share a feed post to story" are NOT
  // available via the API on Instagram or Facebook, so a self-mention is the
  // closest sanctioned tap-through. x/y are optional for stories; we drop the
  // tag near the bottom-center so it sits over the media.
  const username = await getIgUsername(igUserId, accessToken);
  if (username) {
    params.user_tags = [{ username, x: 0.5, y: 0.92 }];
  }

  const { data: container } = await axios.post(`${GRAPH}/${igUserId}/media`, params);

  if (isVideo) await waitForContainer(container.id, accessToken);

  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return { mediaId: data.id };
}

// Look up the connected account's own username so we can mention it on a story.
// Best-effort: if it fails, the story still publishes, just without the mention.
async function getIgUsername(igUserId, accessToken) {
  try {
    const { data } = await axios.get(`${GRAPH}/${igUserId}`, {
      params: { fields: 'username', access_token: accessToken },
    });
    return data.username || null;
  } catch (_) {
    return null;
  }
}

async function publishToFacebook({ pageId, accessToken, post, serverUrl }) {
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

    // Auto-like our own post after it publishes
    if (data.id) {
      await likeFbPost(data.id, accessToken).catch(() => {});
    }

    // Share to Facebook story after feed post
    if (postToStory) {
      const storyResult = await publishFbStory({ pageId, accessToken, mediaType, mediaUrls, serverUrl });
      return { feed: feedResult, story: storyResult };
    }
  } else if (mediaType === 'carousel' || mediaType === 'photo') {
    if (mediaUrls.length > 1) {
      const photoIds = await Promise.all(
        mediaUrls.map(url =>
          axios.post(`${GRAPH}/${pageId}/photos`, {
            url: `${serverUrl}${url}`,
            published: false,
            access_token: accessToken,
          }).then(r => ({ media_fbid: r.data.id }))
        )
      );

      const params = {
        message: caption,
        attached_media: photoIds,
        access_token: accessToken,
      };
      if (locationId) params.place = locationId;

      const { data } = await axios.post(`${GRAPH}/${pageId}/feed`, params);
      feedResult = { postId: data.id, permalink: `https://www.facebook.com/${data.id}` };

      if (data.id) await likeFbPost(data.id, accessToken).catch(() => {});

      if (postToStory) {
        const storyResult = await publishFbStory({ pageId, accessToken, mediaType, mediaUrls, serverUrl });
        return { feed: feedResult, story: storyResult };
      }
    } else {
      const params = {
        url: `${serverUrl}${mediaUrls[0]}`,
        message: caption,
        access_token: accessToken,
      };
      if (locationId) params.place = locationId;

      const { data } = await axios.post(`${GRAPH}/${pageId}/photos`, params);
      feedResult = { photoId: data.id, permalink: `https://www.facebook.com/${data.id}` };

      if (data.id) await likeFbPost(data.id, accessToken).catch(() => {});

      if (postToStory) {
        const storyResult = await publishFbStory({ pageId, accessToken, mediaType, mediaUrls, serverUrl });
        return { feed: feedResult, story: storyResult };
      }
    }
  }

  return { feed: feedResult };
}

async function publishFbStory({ pageId, accessToken, mediaType, mediaUrls, serverUrl }) {
  try {
    if (mediaType === 'video') {
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
          file_url: `${serverUrl}${mediaUrls[0]}`,
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
    } else {
      // For photos, upload unpublished then share to story
      const { data: photo } = await axios.post(`${GRAPH}/${pageId}/photos`, {
        url: `${serverUrl}${mediaUrls[0]}`,
        published: false,
        access_token: accessToken,
      });
      const { data } = await axios.post(`${GRAPH}/${pageId}/photo_stories`, {
        photo_id: photo.id,
        access_token: accessToken,
      });
      return { storyId: data.post_id || data.id };
    }
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
  deleteIgPost,
  deleteFbPost,
};
