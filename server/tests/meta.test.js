const { graphErrorMessage } = require('../services/meta');

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
