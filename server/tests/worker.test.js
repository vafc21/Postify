const { processPost } = require('../services/worker');

jest.mock('../utils/prisma', () => ({
  scheduledPost: {
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  clientToken: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
}));

jest.mock('../services/meta', () => ({
  publishPost: jest.fn(),
}));

const prisma = require('../utils/prisma');
const { publishPost } = require('../services/meta');

describe('processPost', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks post as posting then posted on success', async () => {
    const post = {
      id: 'post-1',
      clientId: 'client-1',
      status: 'uploaded',
      mediaType: 'photo',
      mediaUrls: ['/uploads/photos/test.jpg'],
      caption: 'Hello',
      postToStory: true,
      client: { userId: 'user-1' },
    };

    prisma.clientToken.findMany.mockResolvedValue([
      { platform: 'instagram', accessToken: 'tok', instagramAccountId: 'ig-123', pageId: null },
    ]);
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret' });
    prisma.scheduledPost.updateMany.mockResolvedValue({ count: 1 });
    prisma.scheduledPost.update.mockResolvedValue({});
    publishPost.mockResolvedValue({ instagramResult: { feed: { mediaId: 'ig-post-1' } }, facebookResult: null });

    await processPost(post);

    expect(prisma.scheduledPost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'uploaded' }), data: expect.objectContaining({ status: 'posting' }) })
    );
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'posted' }) })
    );
  });

  test('marks post as failed on Meta API error', async () => {
    const post = {
      id: 'post-1',
      clientId: 'client-1',
      status: 'uploaded',
      client: { userId: 'user-1' },
    };

    prisma.clientToken.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret' });
    prisma.scheduledPost.updateMany.mockResolvedValue({ count: 1 });
    prisma.scheduledPost.update.mockResolvedValue({});
    publishPost.mockRejectedValue(new Error('Meta API error'));

    await processPost(post);

    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });
});
