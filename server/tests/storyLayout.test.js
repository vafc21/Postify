const { sanitizeStoryLayout } = require('../utils/storyLayout');

const wrap = (elements) => sanitizeStoryLayout({ version: 1, background: { type: 'auto' }, elements });
const only = (elements) => wrap(elements).elements;

describe('sanitizeStoryLayout — Storrito stickers', () => {
  test('location round-trips with locationId and design', () => {
    const [el] = only([{ type: 'location', x: 0.5, y: 0.3, location: 'Cologne', locationId: '42', design: 'orange' }]);
    expect(el).toMatchObject({ type: 'location', location: 'Cologne', locationId: '42', design: 'orange' });
  });

  test('hashtag preserves a valid design and clamps an invalid one to default', () => {
    expect(only([{ type: 'hashtag', tag: 'travel', design: 'gray' }])[0].design).toBe('gray');
    expect(only([{ type: 'hashtag', tag: 'travel', design: 'neon' }])[0].design).toBe('default');
  });

  test('link stores the label under `text` (accepting legacy `label`) and keeps design', () => {
    expect(only([{ type: 'link', url: 'https://x.io', text: 'Shop', design: 'black' }])[0]).toMatchObject({ text: 'Shop', design: 'black' });
    expect(only([{ type: 'link', url: 'https://x.io', label: 'Legacy' }])[0].text).toBe('Legacy');
  });

  test('poll keeps up to 4 options and a clamped color', () => {
    const [el] = only([{ type: 'poll', question: 'Q?', options: ['A', 'B', 'C', 'D', 'E'], color: 'pink' }]);
    expect(el.options).toEqual(['A', 'B', 'C', 'D']);
    expect(el.color).toBe('pink');
    expect(only([{ type: 'poll', question: 'Q?', options: ['A', 'B'], color: 'neon' }])[0].color).toBe('black');
  });

  test('mention keeps its design', () => {
    expect(only([{ type: 'mention', username: 'acme', design: 'rainbow' }])[0].design).toBe('rainbow');
  });

  test('unknown element types are dropped', () => {
    expect(only([{ type: 'sparkles' }, { type: 'hashtag', tag: 'x' }]).map((e) => e.type)).toEqual(['hashtag']);
  });

  test('null clears; empty elements returns a valid shape', () => {
    expect(sanitizeStoryLayout(null)).toBeNull();
    expect(wrap([]).elements).toEqual([]);
  });
});
