const { buildInstaStoryHtml, STORRITO_ONLY_TYPES, layoutHasNativeStickers } = require('../services/storrito');

const layout = (elements) => ({ version: 1, background: { type: 'auto' }, elements });
const html = (elements) => buildInstaStoryHtml({ backgroundUrl: 'https://s/card.jpg', layout: layout(elements), fallbackMentionUsername: 'acme' });

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
