// ffmpeg-backed media normalization for the Meta publish pipeline.
//
// Two jobs live here:
//   1. ensureIgImage / ensureJpeg — Instagram's Content Publishing API only
//      accepts JPEG feed images within a 4:5 … 1.91:1 aspect window. The app
//      lets users upload PNG/WebP/GIF at any aspect, so an un-normalized image
//      silently fails on Instagram (while Facebook accepts it) — the post then
//      looks "posted" but never appears on IG. We transcode to a spec-safe JPEG.
//   2. renderVideoStory (added for the video story-card feature) lives alongside
//      because it shares the ffmpeg plumbing.
//
// Everything here is BEST-EFFORT: if ffmpeg is missing or a transform fails we
// return the original URL so we never make publishing worse than before.

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const execFileAsync = promisify(execFile);

// Prefer the bundled static binaries (Render has no system ffmpeg); fall back to
// a PATH lookup so local dev with a system install still works.
let FFMPEG, FFPROBE;
try { FFMPEG = require('ffmpeg-static') || 'ffmpeg'; } catch { FFMPEG = 'ffmpeg'; }
try { FFPROBE = require('ffprobe-static')?.path || 'ffprobe'; } catch { FFPROBE = 'ffprobe'; }

const UPLOADS = path.join(__dirname, '..', 'uploads');

// Instagram feed image aspect-ratio bounds (width / height).
const IG_MIN_AR = 0.8;   // 4:5 portrait
const IG_MAX_AR = 1.91;  // 1.91:1 landscape
const IG_MAX_W = 1080;

// Map a public /uploads/... path to an absolute file path, refusing remote URLs
// and anything that escapes the uploads root (path-traversal guard).
function localPath(publicUrl) {
  if (!publicUrl || /^https?:\/\//i.test(publicUrl)) return null;
  const abs = path.normalize(path.join(__dirname, '..', publicUrl));
  if (abs !== UPLOADS && !abs.startsWith(UPLOADS + path.sep)) return null;
  return abs;
}

// Swap the filename in a public URL, keeping its directory.
function siblingUrl(publicUrl, newName) {
  return publicUrl.replace(path.basename(publicUrl), newName);
}

let _ffmpegOk = null;
async function hasFfmpeg() {
  if (_ffmpegOk !== null) return _ffmpegOk;
  try { await execFileAsync(FFMPEG, ['-version']); _ffmpegOk = true; }
  catch { _ffmpegOk = false; }
  return _ffmpegOk;
}

// Probe the first video/image stream for dimensions and (for video) duration.
async function probe(absPath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json', absPath,
    ]);
    const j = JSON.parse(stdout);
    const s = (j.streams && j.streams[0]) || {};
    return {
      width: s.width || null,
      height: s.height || null,
      duration: parseFloat(j.format && j.format.duration) || null,
    };
  } catch { return null; }
}

const even = (n) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
// Round to an even number in a chosen direction. Padding to an aspect bound must
// land strictly INSIDE the [0.8, 1.91] window, so the rounding direction matters:
// taller (more height) lowers the ratio, shorter raises it.
const evenFloor = (n) => { const f = Math.max(2, Math.floor(n)); return f % 2 ? f - 1 : f; };
const evenCeil = (n) => { const c = Math.max(2, Math.ceil(n)); return c % 2 ? c + 1 : c; };

// Normalize a feed image for Instagram: guarantee JPEG, cap width at 1080, and
// pad out-of-range aspect ratios to the nearest valid bound using a blurred
// cover background (so nothing is cropped and IG accepts it). Returns the new
// public URL, or the original on any failure / when already compliant.
async function ensureIgImage(publicUrl) {
  const abs = localPath(publicUrl);
  if (!abs) return publicUrl;
  if (!(await hasFfmpeg())) return publicUrl;

  const ext = path.extname(abs).toLowerCase();
  const isJpeg = ext === '.jpg' || ext === '.jpeg';
  const meta = await probe(abs);
  const w = meta && meta.width, h = meta && meta.height;
  const ar = w && h ? w / h : 1;
  const inBounds = ar >= IG_MIN_AR && ar <= IG_MAX_AR;
  const smallEnough = !w || w <= IG_MAX_W;
  if (isJpeg && inBounds && smallEnough) return publicUrl; // already compliant

  // Target canvas: keep aspect when in-bounds, else pad to the nearest bound.
  let W, H;
  if (inBounds || !w || !h) {
    W = even(Math.min(w || IG_MAX_W, IG_MAX_W));
    H = even((W) / (ar || 1));
  } else if (ar < IG_MIN_AR) {
    // Too tall: add height (round down) so the ratio stays >= 0.8.
    W = IG_MAX_W; H = evenFloor(IG_MAX_W / IG_MIN_AR);  // 1080x1350 (0.800)
  } else {
    // Too wide: add height (round up) so the ratio stays <= 1.91.
    W = IG_MAX_W; H = evenCeil(IG_MAX_W / IG_MAX_AR);   // 1080x566 (1.908)
  }

  const filter = (inBounds || !w || !h)
    ? `scale=${W}:${H}:force_original_aspect_ratio=decrease`
    : `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=25[bg];`
      + `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;

  const outName = `${uuidv4()}.jpg`;
  const outAbs = path.join(path.dirname(abs), outName);
  try {
    await execFileAsync(FFMPEG, ['-y', '-i', abs, '-vf', filter, '-q:v', '3', outAbs]);
    return siblingUrl(publicUrl, outName);
  } catch {
    return publicUrl;
  }
}

// Lightweight format-only conversion to JPEG (no aspect change) — used for story
// images, which are already sized 9:16 but may be PNG (which IG stories reject).
async function ensureJpeg(publicUrl) {
  const abs = localPath(publicUrl);
  if (!abs) return publicUrl;
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return publicUrl;
  if (!(await hasFfmpeg())) return publicUrl;
  const outName = `${uuidv4()}.jpg`;
  const outAbs = path.join(path.dirname(abs), outName);
  try {
    await execFileAsync(FFMPEG, ['-y', '-i', abs, '-q:v', '3', outAbs]);
    return siblingUrl(publicUrl, outName);
  } catch {
    return publicUrl;
  }
}

// Probe a public /uploads/... media file for dimensions/duration.
async function probeMedia(publicUrl) {
  const abs = localPath(publicUrl);
  if (!abs) return null;
  return probe(abs);
}

const STORY_W = 1080, STORY_H = 1920;
const clampNum = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Fit an image to a centered 1080x1920 story frame with a blurred cover
// background — fixes off-center raw-photo stories (item #4). The full image is
// centered (nothing cropped) over a blurred fill. Returns a new JPEG URL.
async function ensureStoryImage(publicUrl) {
  const abs = localPath(publicUrl);
  if (!abs) return publicUrl;
  if (!(await hasFfmpeg())) return publicUrl;
  const filter =
    `split[a][b];[a]scale=${STORY_W}:${STORY_H}:force_original_aspect_ratio=increase,crop=${STORY_W}:${STORY_H},gblur=sigma=30[bg];`
    + `[b]scale=${STORY_W}:${STORY_H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  const outName = `${uuidv4()}.jpg`;
  const outAbs = path.join(path.dirname(abs), outName);
  try {
    await execFileAsync(FFMPEG, ['-y', '-i', abs, '-vf', filter, '-q:v', '3', outAbs]);
    return siblingUrl(publicUrl, outName);
  } catch {
    return publicUrl;
  }
}

// The marker colour storyRenderer paints into a card's media slot (PHOTO_FILL).
const SLOT_KEY = '0x01fe02';

// Composite a source video INTO the marker slot of a pre-rendered story card
// PNG, producing a spec-compliant 9:16 MP4 — the "reshare-look card with the
// video playing inside" creative (item #5). The card PNG has its media slot
// painted in SLOT_KEY; we colour-key it transparent and reveal the cover-cropped
// video behind it. Duration is clamped to 3–20s (keeps the file under Facebook's
// 10 MB story cap). Returns the public /uploads/... mp4 URL, or null on failure.
async function compositeVideoStory({ cardAbsPath, rect, videoUrl, maxDurationSec = 20 }) {
  const videoAbs = localPath(videoUrl);
  if (!videoAbs || !cardAbsPath || !rect) return null;
  if (!(await hasFfmpeg())) return null;

  const meta = await probe(videoAbs);
  const dur = clampNum(Math.min(meta?.duration || maxDurationSec, maxDurationSec), 3, maxDurationSec);
  const w = even(rect.w), h = even(rect.h), x = Math.round(rect.x), y = Math.round(rect.y);

  const outName = `${uuidv4()}.mp4`;
  const outAbs = path.join(path.dirname(cardAbsPath), outName);

  // black base ← cover-cropped video at the slot ← colour-keyed card on top.
  const filter =
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[vid];`
    + `[2:v][vid]overlay=${x}:${y}[bg];`
    + `[1:v]colorkey=${SLOT_KEY}:0.30:0.10[card];`
    + `[bg][card]overlay=0:0[outv]`;

  try {
    await execFileAsync(FFMPEG, [
      '-y',
      '-stream_loop', '-1', '-i', videoAbs,          // loop short clips to fill 3s min
      '-i', cardAbsPath,
      '-f', 'lavfi', '-i', `color=c=black:s=${STORY_W}x${STORY_H}:d=${dur}:r=30`,
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '0:a?',
      '-t', String(dur),
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-r', '30', '-g', '60', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-b:v', '3M', '-maxrate', '3M', '-bufsize', '6M',
      outAbs,
    ], { timeout: 180000, maxBuffer: 1024 * 1024 * 16 });
    const relDir = path.relative(UPLOADS, path.dirname(outAbs)).split(path.sep).join('/');
    return `/uploads/${relDir}/${outName}`;
  } catch {
    return null;
  }
}

module.exports = {
  hasFfmpeg,
  probe,
  probeMedia,
  ensureIgImage,
  ensureJpeg,
  ensureStoryImage,
  compositeVideoStory,
  _internal: { localPath, FFMPEG, FFPROBE, even, SLOT_KEY },
};
