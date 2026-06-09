const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FFMPEG = require('ffmpeg-static');
const mp = require('../services/mediaProcessor');
const sr = require('../services/storyRenderer');

const UP = path.join(__dirname, '..', 'uploads');
const created = [];

// Generate a fixture with ffmpeg and return its public /uploads URL.
function gen(args, outRel) {
  const abs = path.join(UP, outRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  execFileSync(FFMPEG, ['-y', ...args, abs], { stdio: 'ignore' });
  created.push(abs);
  return '/uploads/' + outRel;
}
const trackOutput = (url) => { created.push(path.join(UP, url.replace('/uploads/', ''))); return url; };

describe('mediaProcessor', () => {
  jest.setTimeout(60000);

  afterAll(() => {
    for (const f of created) { try { fs.unlinkSync(f); } catch { /* best-effort */ } }
  });

  test('ensureIgImage converts a too-wide PNG to an in-bounds JPEG', async () => {
    const url = gen(['-f', 'lavfi', '-i', 'color=c=blue:s=1600x400', '-frames:v', '1'], 'photos/wide_test.png');
    const out = trackOutput(await mp.ensureIgImage(url));
    expect(out).toMatch(/\.jpg$/);
    const m = await mp.probeMedia(out);
    const ar = m.width / m.height;
    expect(ar).toBeGreaterThanOrEqual(0.8);
    expect(ar).toBeLessThanOrEqual(1.91);
  });

  test('ensureIgImage converts a too-tall PNG to an in-bounds JPEG', async () => {
    const url = gen(['-f', 'lavfi', '-i', 'color=c=red:s=600x1600', '-frames:v', '1'], 'photos/tall_test.png');
    const out = trackOutput(await mp.ensureIgImage(url));
    const m = await mp.probeMedia(out);
    const ar = m.width / m.height;
    expect(ar).toBeGreaterThanOrEqual(0.8);
    expect(ar).toBeLessThanOrEqual(1.91);
  });

  test('ensureIgImage leaves an already-compliant JPEG untouched', async () => {
    const url = gen(['-f', 'lavfi', '-i', 'color=c=purple:s=1080x1080', '-frames:v', '1'], 'photos/ok_test.jpg');
    const out = await mp.ensureIgImage(url);
    expect(out).toBe(url);
  });

  test('ensureStoryImage produces a centered 1080x1920 JPEG', async () => {
    const url = gen(['-f', 'lavfi', '-i', 'color=c=green:s=1200x800', '-frames:v', '1'], 'photos/story_test.png');
    const out = trackOutput(await mp.ensureStoryImage(url));
    const m = await mp.probeMedia(out);
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1920);
  });

  test('video story card composites to a spec 1080x1920 mp4', async () => {
    const videoUrl = gen(['-f', 'lavfi', '-i', 'testsrc=size=1080x1080:rate=30:duration=3', '-pix_fmt', 'yuv420p'], 'videos/vid_test.mp4');
    const layout = {
      version: 1,
      background: { type: 'gradient', value: 'linear-gradient(160deg,#0f2027,#203a43)' },
      elements: [{ id: 'post', type: 'post', x: 0.5, y: 0.42, width: 0.72, rotation: 0 }],
    };
    const m = await mp.probeMedia(videoUrl);
    const card = await sr.renderStoryCardForVideo({ layout, caption: 'Hi', displayName: 'Biz', username: 'biz', videoAspect: m.height / m.width });
    created.push(card.pngPath);
    expect(card.rect).toBeTruthy();

    const out = trackOutput(await mp.compositeVideoStory({ cardAbsPath: card.pngPath, rect: card.rect, videoUrl }));
    expect(out).toMatch(/\.mp4$/);
    const om = await mp.probeMedia(out);
    expect(om.width).toBe(1080);
    expect(om.height).toBe(1920);
    expect(om.duration).toBeGreaterThanOrEqual(2.5);
  });
});
