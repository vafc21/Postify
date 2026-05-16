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
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Fix time to 10 AM UTC so the 8am-8pm window check always passes
    jest.setSystemTime(new Date('2024-06-15T14:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

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
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret', timezone: 'UTC', notificationWebhookUrl: null });
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
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret', timezone: 'UTC', notificationWebhookUrl: null });
    prisma.scheduledPost.updateMany.mockResolvedValue({ count: 1 });
    prisma.scheduledPost.update.mockResolvedValue({});
    publishPost.mockRejectedValue(new Error('Meta API error'));

    await processPost(post);

    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });

  test('releases claim and skips publish outside 8am-8pm window', async () => {
    // 2 AM UTC — outside the posting window for all common timezones
    jest.setSystemTime(new Date('2024-06-15T02:00:00Z'));

    const post = {
      id: 'post-1',
      clientId: 'client-1',
      status: 'uploaded',
      client: { userId: 'user-1' },
    };

    prisma.clientToken.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ metaAppId: 'app-id', metaAppSecret: 'secret', timezone: 'UTC', notificationWebhookUrl: null });
    prisma.scheduledPost.updateMany.mockResolvedValue({ count: 1 });
    prisma.scheduledPost.update.mockResolvedValue({});

    await processPost(post);

    // Claim is released back to 'uploaded', never marked posted/failed
    expect(prisma.scheduledPost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'posting' }), data: expect.objectContaining({ status: 'uploaded' }) })
    );
    expect(publishPost).not.toHaveBeenCalled();
    expect(prisma.scheduledPost.update).not.toHaveBeenCalled();
  });
});
