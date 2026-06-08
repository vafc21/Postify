const fs = require('fs');
const path = require('path');
const { renderStoryToFile } = require('../services/storyRenderer');

const UPLOADS = path.join(__dirname, '../uploads');
const SRC_REL = '/uploads/photos/_test_src.png';
// 1×1 transparent PNG
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function pngSize(buf) {
  // PNG: 8-byte signature, then IHDR chunk; width/height are big-endian at offsets 16/20.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

beforeAll(() => {
  fs.mkdirSync(path.join(UPLOADS, 'photos'), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, 'photos', '_test_src.png'), PNG_1x1);
});

const written = [];
function abs(url) {
  const p = path.join(__dirname, '..', url);
  written.push(p);
  return p;
}
afterAll(() => {
  for (const p of written) fs.existsSync(p) && fs.unlinkSync(p);
  fs.existsSync(path.join(UPLOADS, 'photos', '_test_src.png')) && fs.unlinkSync(path.join(UPLOADS, 'photos', '_test_src.png'));
});

const baseLayout = {
  version: 1,
  background: { type: 'auto' },
  elements: [
    { id: 'post', type: 'post', x: 0.5, y: 0.4, width: 0.62, rotation: 0 },
    { id: 't1', type: 'text', x: 0.5, y: 0.12, rotation: 0, text: 'Hello', size: 60, color: '#fff', bold: true },
    { id: 'mention', type: 'mention', x: 0.4, y: 0.7, rotation: 0 },
  ],
};

describe('renderStoryToFile', () => {
  it('renders a 1080x1920 PNG and returns mention coords from the layout', async () => {
    const res = await renderStoryToFile({
      layout: baseLayout,
      mediaType: 'photo',
      mediaUrls: [SRC_REL],
      caption: 'A caption',
      displayName: 'Bloom & Bean',
      username: 'bloomandbean',
    });

    expect(res.url).toMatch(/^\/uploads\/stories\/.+\.png$/);
    const buf = fs.readFileSync(abs(res.url));
    expect(buf.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
    expect(pngSize(buf)).toEqual({ width: 1080, height: 1920 });
    expect(res.mention).toEqual({ username: 'bloomandbean', x: 0.4, y: 0.7 });
  });

  it('returns null mention when the layout has no mention element', async () => {
    const layout = { ...baseLayout, elements: baseLayout.elements.filter((e) => e.type !== 'mention') };
    const res = await renderStoryToFile({ layout, mediaType: 'photo', mediaUrls: [SRC_REL], username: 'bloomandbean' });
    abs(res.url);
    expect(res.mention).toBeNull();
  });

  it('returns null mention when no username is available, even with a mention element', async () => {
    const res = await renderStoryToFile({ layout: baseLayout, mediaType: 'photo', mediaUrls: [SRC_REL], username: '' });
    abs(res.url);
    expect(res.mention).toBeNull();
  });

  it('still renders when the source image is missing (best-effort assets)', async () => {
    const res = await renderStoryToFile({ layout: baseLayout, mediaType: 'photo', mediaUrls: ['/uploads/photos/_does_not_exist.png'], username: 'x' });
    const buf = fs.readFileSync(abs(res.url));
    expect(pngSize(buf)).toEqual({ width: 1080, height: 1920 });
  });

  it('clamps a hostile layout (huge font, long text, many elements) without crashing', async () => {
    const hostile = {
      version: 1,
      background: { type: 'auto' },
      elements: [
        { id: 'post', type: 'post', x: 0.5, y: 0.4, width: 0.62, rotation: 0 },
        { id: 'big', type: 'text', x: 0.5, y: 0.5, rotation: 0, text: 'x'.repeat(5000), size: 100000, color: '#fff', bold: true },
        // far more than the 50-element cap
        ...Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, type: 'text', x: 0.5, y: 0.5, rotation: 0, text: 'hi', size: 40 })),
      ],
    };
    const res = await renderStoryToFile({ layout: hostile, mediaType: 'photo', mediaUrls: [SRC_REL], username: 'x' });
    const buf = fs.readFileSync(abs(res.url));
    expect(pngSize(buf)).toEqual({ width: 1080, height: 1920 });
  });
});
