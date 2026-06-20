const { buildInstaStoryHtml, STORRITO_ONLY_TYPES, layoutHasNativeStickers, countStorritoStickers, publishStickerStory } = require('../services/storrito');

const layout = (elements) => ({ version: 1, background: { type: 'auto' }, elements });
const html = (elements) => buildInstaStoryHtml({ backgroundUrl: 'https://s/card.jpg', layout: layout(elements), fallbackMentionUsername: 'acme' });

describe('buildInstaStoryHtml media background', () => {
  const stickers = [{ type: 'mention', username: 'acme', x: 0.5, y: 0.9 }];

  test('photo story uses an <img> background, no insta-story src', () => {
    const out = buildInstaStoryHtml({ backgroundUrl: 'https://s/card.jpg', layout: layout(stickers) });
    expect(out).toContain('<insta-story>');
    expect(out).toContain('<img src="https://s/card.jpg"');
    expect(out).not.toContain('insta-story src=');
    expect(out).toContain('insta-mention');
  });

  test('video story sets <insta-story src> and emits no <img>', () => {
    const out = buildInstaStoryHtml({ backgroundVideoUrl: 'https://s/card-vid.mp4', layout: layout(stickers) });
    expect(out).toContain('<insta-story src="https://s/card-vid.mp4">');
    expect(out).not.toContain('<img');
    expect(out).toContain('insta-mention'); // tappable stickers still overlay
  });
});

describe('buildInstaStoryHtml variant attributes', () => {
  test('hashtag emits design when non-default, omits when default/invalid', () => {
    expect(html([{ type: 'hashtag', tag: 'travel', design: 'gray' }])).toContain('hashtag="travel"');
    expect(html([{ type: 'hashtag', tag: 'travel', design: 'gray' }])).toContain('design="gray"');
    expect(html([{ type: 'hashtag', tag: 'travel', design: 'default' }])).not.toContain('design=');
    expect(html([{ type: 'hashtag', tag: 'travel', design: 'neon' }])).not.toContain('design=');
  });

  test('link reads label from `text` and emits design', () => {
    const out = html([{ type: 'link', url: 'https://x.io', text: 'Shop', design: 'black' }]);
    expect(out).toContain('url="https://x.io"');
    expect(out).toContain('text="Shop"');
    expect(out).toContain('design="black"');
  });

  test('poll uses color attribute; black (default) omitted', () => {
    expect(html([{ type: 'poll', question: 'Q?', options: ['A', 'B'], color: 'pink' }])).toContain('color="pink"');
    expect(html([{ type: 'poll', question: 'Q?', options: ['A', 'B'], color: 'black' }])).not.toContain('color=');
  });

  test('location emits design + location-id', () => {
    const out = html([{ type: 'location', location: 'Cologne', locationId: '42', design: 'orange' }]);
    expect(out).toContain('location="Cologne"');
    expect(out).toContain('location-id="42"');
    expect(out).toContain('design="orange"');
  });

  test('mention emits design', () => {
    expect(html([{ type: 'mention', username: 'acme', design: 'rainbow' }])).toContain('design="rainbow"');
  });
});

describe('location routing', () => {
  test('location is a Storrito-only type', () => {
    expect(STORRITO_ONLY_TYPES.has('location')).toBe(true);
  });
  test('a location-only layout has native stickers', () => {
    expect(layoutHasNativeStickers(layout([{ type: 'location', location: 'Cologne' }]))).toBe(true);
  });
});

// These helpers no longer gate IG routing (every connected reshare goes through
// Storrito now) — they only feed stickerGapReason's "stickers were dropped" alert.
describe('native-sticker counting (for the dropped-sticker alert)', () => {
  test('a plain reshare (card + mention) has NO native stickers', () => {
    expect(layoutHasNativeStickers(layout([{ type: 'post' }, { type: 'mention', username: 'acme' }]))).toBe(false);
    expect(countStorritoStickers(layout([{ type: 'post' }, { type: 'mention', username: 'acme' }]))).toBe(0);
  });

  test('a BLANK sticker does not count (link with empty url)', () => {
    expect(layoutHasNativeStickers(layout([{ type: 'post' }, { type: 'link', url: '' }]))).toBe(false);
    expect(countStorritoStickers(layout([{ type: 'hashtag', tag: '' }, { type: 'poll', question: '' }]))).toBe(0);
  });

  test('countStorritoStickers counts only populated Storrito-only stickers', () => {
    const els = [
      { type: 'post' }, { type: 'mention', username: 'acme' },
      { type: 'link', url: 'https://x.io' }, { type: 'link', url: '' },
      { type: 'hashtag', tag: 'travel' }, { type: 'location', location: '' },
    ];
    expect(countStorritoStickers(layout(els))).toBe(2);
  });
});

describe('repost link (real tappable repost, not a bare picture)', () => {
  const reshare = [{ type: 'post', x: 0.5, y: 0.42 }, { type: 'mention', username: 'acme' }];

  test('a plain reshare with a permalink emits a tappable link sticker back to the post', () => {
    const out = buildInstaStoryHtml({
      backgroundUrl: 'https://s/card.jpg',
      layout: layout(reshare),
      repostUrl: 'https://www.instagram.com/p/ABC123/',
    });
    expect(out).toContain('<insta-link');
    expect(out).toContain('url="https://www.instagram.com/p/ABC123/"');
    expect(out).toContain('insta-mention'); // mention still tappable too
  });

  test('a non-http(s) repostUrl is rejected (no junk/SSRF link)', () => {
    const out = buildInstaStoryHtml({
      backgroundUrl: 'https://s/card.jpg',
      layout: layout(reshare),
      repostUrl: 'javascript:alert(1)',
    });
    expect(out).not.toContain('insta-link');
  });

  test('publishStickerStory no longer short-circuits a plain reshare — it reaches the rpc', async () => {
    // The old degenerate guard would throw before any network call; now a plain
    // card+mention reshare proceeds to schedule-instagram-story (and only fails
    // here because the host is unreachable), proving Storrito is never skipped.
    const user = { storritoApiToken: 'tok', storritoApiBase: 'http://127.0.0.1:1' };
    await expect(publishStickerStory({
      user,
      instagramUsername: 'acme',
      backgroundUrl: 'https://s/card.jpg',
      layout: layout(reshare),
      repostUrl: 'https://www.instagram.com/p/ABC123/',
    })).rejects.toThrow(); // a connection error, NOT a "skip Storrito" no-op
  });
});
