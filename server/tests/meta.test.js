const { graphErrorMessage, appendCaptionLink } = require('../services/meta');

describe('graphErrorMessage', () => {
  test('extracts the Graph API error message when present', () => {
    const err = {
      response: { data: { error: { message: '(#10) Requires Page Public Content Access' } } },
    };
    expect(graphErrorMessage(err)).toBe('(#10) Requires Page Public Content Access');
  });

  test('falls back to the JS error message', () => {
    expect(graphErrorMessage(new Error('socket hang up'))).toBe('socket hang up');
  });

  test('returns a generic message when nothing is available', () => {
    expect(graphErrorMessage({})).toBe('Unknown error');
  });
});

describe('appendCaptionLink', () => {
  test('appends the link on its own line below the caption', () => {
    expect(appendCaptionLink('Check this out', 'https://x.com/p')).toBe('Check this out\n\nhttps://x.com/p');
  });

  test('returns just the link when there is no caption', () => {
    expect(appendCaptionLink('', 'https://x.com/p')).toBe('https://x.com/p');
    expect(appendCaptionLink(null, 'https://x.com/p')).toBe('https://x.com/p');
  });

  test('leaves the caption untouched when there is no link', () => {
    expect(appendCaptionLink('Hello', '')).toBe('Hello');
    expect(appendCaptionLink('Hello', null)).toBe('Hello');
    expect(appendCaptionLink('Hello', '   ')).toBe('Hello');
  });

  test('is idempotent — does not duplicate a link already in the caption', () => {
    const caption = 'See https://x.com/p for more';
    expect(appendCaptionLink(caption, 'https://x.com/p')).toBe(caption);
  });
});
