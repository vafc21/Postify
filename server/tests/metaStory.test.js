jest.mock('axios');
jest.mock('../utils/encryption', () => ({ readToken: (t) => t, decrypt: (t) => t }));
jest.mock('../services/storyRenderer', () => ({
  renderStoryToFile: jest.fn(),
  renderStoryCardForVideo: jest.fn(),
}));
// Identity media helpers so the publish path doesn't shell out to ffmpeg; the
// video-card compositor and probe are mocked so the video story path is exercised
// for real (previously renderStoryCardForVideo was left out of the mock, so the
// call threw and was silently swallowed — masking the whole video-card feature).
jest.mock('../services/mediaProcessor', () => ({
  ensureIgImage: (u) => u,
  ensureJpeg: (u) => u,
  ensureStoryImage: (u) => u,
  probeMedia: jest.fn(),
  compositeVideoStory: jest.fn(),
}));

const axios = require('axios');
const { renderStoryToFile, renderStoryCardForVideo } = require('../services/storyRenderer');
const { compositeVideoStory, probeMedia } = require('../services/mediaProcessor');
const { publishPost } = require('../services/meta');

const SERVER = 'http://server';

function igPost(overrides = {}) {
  return {
    id: 'p1',
    mediaType: 'photo',
    mediaUrls: ['/uploads/photos/a.jpg'],
    caption: 'hello world',
    postToStory: true,
    storyLayout: { version: 1, background: { type: 'auto' }, elements: [{ type: 'post' }, { type: 'mention' }] },
    client: { businessName: 'Biz' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  renderStoryToFile.mockResolvedValue({ url: '/uploads/stories/x.png', mention: { username: 'acct', x: 0.4, y: 0.7 } });
  renderStoryCardForVideo.mockResolvedValue({ url: '/uploads/stories/card.png', pngPath: '/abs/card.png', rect: { x: 10, y: 20, w: 700, h: 500 }, mention: { username: 'acct', x: 0.5, y: 0.8 } });
  compositeVideoStory.mockResolvedValue('/uploads/stories/vstory.mp4');
  probeMedia.mockResolvedValue({ width: 1080, height: 1350, duration: 8 });
  axios.get.mockResolvedValue({ data: { username: 'acct', name: 'Acct', profile_picture_url: null, permalink: 'http://post', status_code: 'FINISHED' } });
  axios.post.mockResolvedValue({ data: { id: 'media1', post_id: 'pp1' } });
});

const igTokens = [{ platform: 'instagram', accessToken: 'tok', instagramAccountId: 'ig1' }];

function storyContainerCall() {
  return axios.post.mock.calls.find(([url, body]) => /\/ig1\/media$/.test(url) && body && body.media_type === 'STORIES');
}

describe('publishPost — custom story rendering', () => {
  it('renders the layout and publishes the rendered image + mention to the IG story', async () => {
    const post = igPost();
    const res = await publishPost(post, igTokens, {}, SERVER);

    // renderer invoked with the saved layout + resolved username
    expect(renderStoryToFile).toHaveBeenCalledTimes(1);
    const arg = renderStoryToFile.mock.calls[0][0];
    expect(arg.layout).toBe(post.storyLayout);
    expect(arg.mediaUrls).toEqual(['/uploads/photos/a.jpg']);
    expect(arg.username).toBe('acct');

    // the IG STORIES container used the rendered image and the mention coords
    const call = storyContainerCall();
    expect(call).toBeTruthy();
    const body = call[1];
    expect(body.image_url).toBe(`${SERVER}/uploads/stories/x.png`);
    expect(body.user_tags).toEqual([{ username: 'acct', x: 0.4, y: 0.7 }]);

    expect(res.instagramResult.story).toEqual({ mediaId: 'media1' });
    expect(res.facebookResult).toBeNull();
  });

  it('renders the DEFAULT reshare card when there is no saved layout', async () => {
    // No saved layout no longer means a bare centered photo — it falls back to the
    // default reshare card (matching the editor default and the native phone "add
    // post to your story"), so the renderer IS invoked with a 'post' card element.
    const post = igPost({ storyLayout: null });
    await publishPost(post, igTokens, {}, SERVER);

    expect(renderStoryToFile).toHaveBeenCalledTimes(1);
    const arg = renderStoryToFile.mock.calls[0][0];
    expect(arg.layout.elements.some((e) => e.type === 'post')).toBe(true);

    const body = storyContainerCall()[1];
    expect(body.image_url).toBe(`${SERVER}/uploads/stories/x.png`);
    // the default card includes a mention → tappable user_tag at the rendered coords
    expect(body.user_tags).toEqual([{ username: 'acct', x: 0.4, y: 0.7 }]);
  });

  it('omits the mention when it was removed from a custom layout', async () => {
    // A rendered card whose layout has no mention element returns mention:null —
    // the user explicitly removed it, so no user_tag should be sent.
    renderStoryToFile.mockResolvedValueOnce({ url: '/uploads/stories/x.png', mention: null });
    const post = igPost();
    await publishPost(post, igTokens, {}, SERVER);

    const body = storyContainerCall()[1];
    expect(body.image_url).toBe(`${SERVER}/uploads/stories/x.png`);
    expect(body.user_tags).toBeUndefined();
  });

  it('renders a video story card and publishes the composited video', async () => {
    const post = igPost({ mediaType: 'video', mediaUrls: ['/uploads/videos/v.mp4'] });
    await publishPost(post, igTokens, {}, SERVER);

    // the video-card path is taken (not a raw-video fallback)
    expect(renderStoryCardForVideo).toHaveBeenCalledTimes(1);
    expect(compositeVideoStory).toHaveBeenCalledTimes(1);
    expect(renderStoryToFile).not.toHaveBeenCalled();

    const body = storyContainerCall()[1];
    expect(body.video_url).toBe(`${SERVER}/uploads/stories/vstory.mp4`);
  });

  it('skips Instagram entirely when it already published (idempotent retry)', async () => {
    // A retry of a post whose IG feed already went live must NOT re-publish it.
    const post = igPost({ instagramResult: { feed: { mediaId: 'already-live' } } });
    const res = await publishPost(post, igTokens, {}, SERVER);

    expect(renderStoryToFile).not.toHaveBeenCalled();
    expect(storyContainerCall()).toBeFalsy();
    expect(axios.post.mock.calls.some(([url]) => /\/media_publish$/.test(url))).toBe(false);
    expect(res.instagramResult).toEqual({ feed: { mediaId: 'already-live' } });
  });
});

describe('publishToFacebook — result shape', () => {
  const fbTokens = [{ platform: 'facebook', accessToken: 'tok', pageId: 'pg1' }];

  it('returns a deletable postId for a single-photo Facebook post', async () => {
    axios.post.mockResolvedValue({ data: { id: 'fb-obj-1' } });
    const post = igPost({ postToStory: false });
    const res = await publishPost(post, fbTokens, {}, SERVER);

    // Every FB branch must expose the object id as `postId` — that's the key the
    // unpost route uses to delete the post.
    expect(res.facebookResult.feed.postId).toBe('fb-obj-1');
  });

  it('returns a deletable postId for a Facebook video post', async () => {
    axios.post.mockResolvedValue({ data: { id: 'fb-vid-1' } });
    const post = igPost({ mediaType: 'video', mediaUrls: ['/uploads/videos/v.mp4'], postToStory: false });
    const res = await publishPost(post, fbTokens, {}, SERVER);

    expect(res.facebookResult.feed.postId).toBe('fb-vid-1');
  });
});
