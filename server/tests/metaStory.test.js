jest.mock('axios');
jest.mock('../utils/encryption', () => ({ readToken: (t) => t, decrypt: (t) => t }));
jest.mock('../services/storyRenderer', () => ({ renderStoryToFile: jest.fn() }));

const axios = require('axios');
const { renderStoryToFile } = require('../services/storyRenderer');
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

  it('falls back to the first image (no render) when there is no layout', async () => {
    const post = igPost({ storyLayout: null });
    await publishPost(post, igTokens, {}, SERVER);

    expect(renderStoryToFile).not.toHaveBeenCalled();
    const body = storyContainerCall()[1];
    expect(body.image_url).toBe(`${SERVER}/uploads/photos/a.jpg`);
    // still mentions the account at the default bottom-center
    expect(body.user_tags).toEqual([{ username: 'acct', x: 0.5, y: 0.92 }]);
  });

  it('does not render a custom story for video posts', async () => {
    const post = igPost({ mediaType: 'video', mediaUrls: ['/uploads/videos/v.mp4'] });
    await publishPost(post, igTokens, {}, SERVER);
    expect(renderStoryToFile).not.toHaveBeenCalled();
    const body = storyContainerCall()[1];
    expect(body.video_url).toBe(`${SERVER}/uploads/videos/v.mp4`);
  });
});
