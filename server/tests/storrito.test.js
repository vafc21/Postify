const { buildInstaStoryHtml, STORRITO_ONLY_TYPES, layoutHasNativeStickers } = require('../services/storrito');

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
