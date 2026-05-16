const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v18.0';

async function publishPost(post, tokens, appCreds, serverUrl) {
  const results = { instagramResult: null, facebookResult: null };

  const igToken = tokens.find(t => t.platform === 'instagram');
  const fbToken = tokens.find(t => t.platform === 'facebook');

  if (igToken && igToken.instagramAccountId) {
    try {
      results.instagramResult = await publishToInstagram({
        igUserId: igToken.instagramAccountId,
        accessToken: igToken.accessToken,
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
        accessToken: fbToken.accessToken,
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
  const { mediaType, mediaUrls, caption, postToStory } = post;
  const feedResult = await publishIgFeed({ igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl });

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

async function publishIgFeed({ igUserId, accessToken, mediaType, mediaUrls, caption, serverUrl }) {
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

    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    });
    creationId = data.id;
  } else if (mediaType === 'video') {
    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, {
      media_type: 'REELS',
      video_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    });
    creationId = data.id;
    await waitForContainer(creationId, accessToken);
  } else {
    const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, {
      image_url: `${serverUrl}${mediaUrls[0]}`,
      caption,
      access_token: accessToken,
    });
    creationId = data.id;
  }

  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
  return { mediaId: data.id, creationId };
}

async function publishIgStory({ igUserId, accessToken, mediaType, mediaUrls, serverUrl }) {
  const isVideo = mediaType === 'video';
  const params = isVideo
    ? { media_type: 'VIDEO', video_url: `${serverUrl}${mediaUrls[0]}` }
    : { image_url: `${serverUrl}${mediaUrls[0]}` };

  const { data: container } = await axios.post(`${GRAPH}/${igUserId}/media`, {
    ...params,
    media_type: isVideo ? 'VIDEO' : undefined,
    is_story: !isVideo ? true : undefined,
    access_token: accessToken,
  });

  if (isVideo) await waitForContainer(container.id, accessToken);

  const { data } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return { mediaId: data.id };
}

async function publishToFacebook({ pageId, accessToken, post, serverUrl }) {
  const { mediaType, mediaUrls, caption } = post;
  let feedResult;

  if (mediaType === 'video') {
    const { data } = await axios.post(`${GRAPH}/${pageId}/videos`, {
      file_url: `${serverUrl}${mediaUrls[0]}`,
      description: caption,
      access_token: accessToken,
    });
    feedResult = { videoId: data.id };
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
      const { data } = await axios.post(`${GRAPH}/${pageId}/feed`, {
        message: caption,
        attached_media: photoIds,
        access_token: accessToken,
      });
      feedResult = { postId: data.id };
    } else {
      const { data } = await axios.post(`${GRAPH}/${pageId}/photos`, {
        url: `${serverUrl}${mediaUrls[0]}`,
        message: caption,
        access_token: accessToken,
      });
      feedResult = { photoId: data.id };
    }
  }

  return { feed: feedResult };
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
  deleteIgPost,
  deleteFbPost,
};
