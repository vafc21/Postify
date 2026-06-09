const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const satori = require('satori').default || require('satori');
const { Resvg } = require('@resvg/resvg-js');

// Instagram/Facebook stories are 1080×1920 (9:16). We render the editor layout
// to a flat PNG at that size and publish it as a normal image story.
const W = 1080;
const H = 1920;

const FONT_DIR = path.join(__dirname, '../assets/fonts');
const FONTS = [
  { name: 'Inter', weight: 400, style: 'normal', data: fs.readFileSync(path.join(FONT_DIR, 'Inter-Regular.woff')) },
  { name: 'Inter', weight: 700, style: 'normal', data: fs.readFileSync(path.join(FONT_DIR, 'Inter-Bold.woff')) },
];

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// Distinctive fill for the post-card photo placeholder. Satori can't size an
// image inside the card, so we render a flat marker here and paint the real
// photo into its rectangle afterwards with resvg. Chosen to not collide with
// card chrome or text colours.
const PHOTO_FILL = '#01fe02';
const isMarker = (r, g, b) => r < 12 && g > 245 && b < 12;

// Minimal PNG decoder (8-bit RGBA, non-interlaced — what resvg emits).
function decodePng(buf) {
  let p = 8, W = 0, H = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { W = buf.readUInt32BE(p + 8); H = buf.readUInt32BE(p + 12); }
    else if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = require('zlib').inflateSync(Buffer.concat(idat));
  const ch = 4, stride = W * ch, out = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], rs = y * (stride + 1) + 1, os = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rs + x], a = x >= ch ? out[os + x - ch] : 0, b = y > 0 ? out[os - stride + x] : 0, c = (x >= ch && y > 0) ? out[os - stride + x - ch] : 0;
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); }
      out[os + x] = r & 255;
    }
  }
  return { W, H, at: (x, y) => { const o = y * stride + x * ch; return [out[o], out[o + 1], out[o + 2]]; } };
}

// Axis-aligned bounding box of the marker-coloured pixels, or null if none.
function markerBBox(dec) {
  let l = 1e9, r = -1, t = 1e9, b = -1;
  for (let y = 0; y < dec.H; y += 2) {
    for (let x = 0; x < dec.W; x += 2) {
      const [pr, pg, pb] = dec.at(x, y);
      if (isMarker(pr, pg, pb)) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    }
  }
  return r < 0 ? null : { l, r, t, b };
}

// ── tiny hyperscript helper so the element tree reads top-to-bottom ──
function h(type, style, children) {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}
function img(src, style) {
  // flexShrink:0 is load-bearing: as a flex child, Satori/Yoga will otherwise
  // shrink the image below its set width (notably when other absolutely-
  // positioned siblings exist), leaving a blank strip beside an object-fit image.
  return { type: 'img', props: { src, style: { flexShrink: 0, ...style } } };
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5));

// Pre-resize an image to EXACTLY w×h pixels (cover/center-crop) via resvg, and
// return it as a data URI. Satori sizes embedded images by their intrinsic
// dimensions and ignores width/min/max constraints, so we hand it an image
// whose natural size already equals the target box — then it can't shrink it.
function resizeToCover(dataUri, w, h) {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><image xlink:href="${dataUri}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></svg>`;
    return `data:image/png;base64,${new Resvg(svg).render().asPng().toString('base64')}`;
  } catch (_) {
    return dataUri;
  }
}

// Read intrinsic pixel dimensions from an image buffer (no decode lib needed).
function imageSize(buf, ext) {
  try {
    if (ext === '.png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === '.gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (ext === '.jpg' || ext === '.jpeg') {
      let i = 2;
      while (i < buf.length - 8) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch (_) { /* fall through */ }
  return null;
}

// Intrinsic size of a local /uploads image, for matching the card photo box to
// the post's aspect ratio (so the image fills with no gap and no crop). Satori
// sizes background images by their intrinsic aspect, so the box must match.
function localImageSize(src) {
  try {
    if (!src || /^https?:\/\//i.test(src)) return null;
    const root = path.join(__dirname, '..', 'uploads');
    const abs = path.normalize(path.join(__dirname, '..', src));
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return imageSize(fs.readFileSync(abs), path.extname(abs).toLowerCase());
  } catch (_) {
    return null;
  }
}

// Resolve a /uploads/... path or remote URL into a base64 data URI that resvg
// can rasterize. Best-effort: returns null so a missing asset never aborts a render.
async function toDataUri(src) {
  if (!src) return null;
  try {
    if (/^https?:\/\//i.test(src)) {
      const { data, headers } = await axios.get(src, { responseType: 'arraybuffer', timeout: 8000 });
      const mime = headers['content-type'] || 'image/jpeg';
      return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
    }
    // Local upload only — resolve and confirm the path stays inside /uploads.
    const root = path.join(__dirname, '..', 'uploads');
    const abs = path.normalize(path.join(__dirname, '..', src));
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    const ext = path.extname(abs).toLowerCase();
    return `data:${MIME[ext] || 'image/jpeg'};base64,${fs.readFileSync(abs).toString('base64')}`;
  } catch (_) {
    return null;
  }
}

// Center-anchored absolute placement + rotation. translate(-50%,-50%) keeps the
// element centered on (x,y) regardless of its measured size.
function placed(el, style, children) {
  const cx = clamp01(el.x) * W;
  const cy = clamp01(el.y) * H;
  const rot = Number.isFinite(el.rotation) ? el.rotation : 0;
  return h('div', {
    position: 'absolute',
    left: cx,
    top: cy,
    display: 'flex',
    transform: `translate(-50%, -50%) rotate(${rot}deg)`,
    ...style,
  }, children);
}

// Paint the story background directly onto a style object for the ROOT element.
// Crucially we do NOT add a full-width absolutely-positioned background child:
// such a sibling makes Satori/Yoga shrink the card's <img> (leaving a blank
// strip). Putting the fill on the root sidesteps that bug entirely.
function applyBackground(style, bg, ctx) {
  if (bg && bg.type === 'color' && bg.value) {
    style.backgroundColor = bg.value;
  } else if (bg && bg.type === 'gradient' && bg.value) {
    style.backgroundImage = bg.value;
  } else if (bg && bg.type === 'image' && ctx.bgUri) {
    style.backgroundImage = `url(${ctx.bgUri})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  } else if (ctx.photoUri) {
    // 'auto' — the post photo, darkened with a scrim layered on top for legibility.
    style.backgroundImage = `linear-gradient(rgba(10,12,18,0.55),rgba(10,12,18,0.55)), url(${ctx.photoUri})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  } else {
    style.backgroundImage = 'linear-gradient(165deg,#3b2f6b,#b5377e 52%,#ff8a5b)';
  }
}

function postCard(el, ctx) {
  const cardW = clamp01(el.width || 0.62) * W;
  // 4:5-ish landscape photo area with object-fit:cover. This ratio reliably
  // fills the width in Satori (a square box hit a Yoga sizing bug that left a
  // blank strip). cover crops top/bottom slightly; the width always fills.
  // Match the photo box to the post image's real aspect ratio — Satori sizes a
  // background image by its intrinsic aspect, so a mismatched box leaves a blank
  // strip. Clamp so very tall/wide posts don't make an extreme card (those crop
  // slightly via cover). Falls back to 4:5-ish when the size is unknown.
  const aspect = Math.max(0.6, Math.min(1.25, ctx.photoAspect || 0.82));
  const photoH = Math.round(cardW * aspect);
  // Render images as background-image DIVs, not <img> elements: Satori mis-sizes
  // <img> flex children (shrinks them, leaving a blank strip), but a div with an
  // explicit size + backgroundSize:cover fills reliably.
  const avatar = ctx.avatarUri
    ? h('div', { width: 56, height: 56, borderRadius: 28, flexShrink: 0, backgroundImage: `url(${ctx.avatarUri})`, backgroundSize: 'cover', backgroundPosition: 'center' })
    : h('div', { width: 56, height: 56, borderRadius: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1877F2', color: '#fff', fontSize: 26, fontWeight: 700 }, (ctx.displayName || '?').slice(0, 1).toUpperCase());

  const header = h('div', { display: 'flex', alignItems: 'center', padding: '18px 20px', width: '100%' }, [
    avatar,
    h('div', { display: 'flex', flexDirection: 'column', marginLeft: 14, flexGrow: 1 }, [
      h('div', { fontSize: 26, fontWeight: 700, color: '#0a0a0a' }, ctx.displayName || ''),
      h('div', { fontSize: 19, color: '#65676b' }, '2h'),
    ]),
    h('div', { fontSize: 30, color: '#65676b', fontWeight: 700, flexShrink: 0 }, '···'),
  ]);

  // The photo is composited in afterwards with resvg (Satori can't reliably size
  // an image inside the card — it shrinks it). Here we just reserve the space
  // with a flat placeholder; PHOTO_FILL marks the area so the compositor can
  // locate the exact rectangle to paint the real photo into.
  const photo = ctx.photoUri
    ? h('div', { width: cardW, height: photoH, flexShrink: 0, display: 'flex', backgroundColor: PHOTO_FILL })
    : h('div', { width: cardW, height: photoH, display: 'flex', flexShrink: 0, backgroundImage: 'linear-gradient(150deg,#f8b259,#ef6f53 45%,#b5377e)' });

  const children = [header, photo];
  if (ctx.caption) {
    children.push(h('div', { display: 'flex', padding: '16px 20px', fontSize: 24, lineHeight: 1.35, color: '#1c1e21' }, ctx.caption));
  }

  return placed(el, {
    width: cardW,
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    borderRadius: 26,
    overflow: 'hidden',
    boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
  }, children);
}

function textBox(el) {
  // Clamp the font size: resvg PANICS (native crash, not a catchable JS throw)
  // on absurd sizes, which would take down the publish worker. Cap text length
  // too — very long strings make satori's layout pass block the event loop.
  const size = Math.min(Math.max(Number(el.size) || 56, 8), 200);
  return placed(el, {
    maxWidth: W * 0.86,
    fontSize: size,
    fontWeight: el.bold === false ? 400 : 700,
    color: el.color || '#ffffff',
    textAlign: el.align || 'center',
    textShadow: '0 2px 14px rgba(0,0,0,0.45)',
    padding: '4px 10px',
  }, String(el.text || '').slice(0, 200));
}

function mentionSticker(el, ctx) {
  const s = Math.max(0.6, Math.min(2.2, Number(el.scale) || 1));
  return placed(el, {
    backgroundColor: 'rgba(0,0,0,0.55)',
    border: `${Math.max(1, Math.round(2 * s))}px solid rgba(255,255,255,0.25)`,
    borderRadius: 16 * s,
    padding: `${14 * s}px ${22 * s}px`,
  }, h('div', { fontSize: 30 * s, fontWeight: 700, color: '#ffffff' }, `@${ctx.username || ''}`));
}

function elementNode(el, ctx) {
  if (!el || !el.type) return null;
  if (el.type === 'post') return postCard(el, ctx);
  if (el.type === 'text') return textBox(el);
  if (el.type === 'mention') return ctx.username ? mentionSticker(el, ctx) : null;
  return null;
}

function buildTree(layout, ctx) {
  const rootStyle = {
    position: 'relative',
    width: W,
    height: H,
    display: 'flex',
    overflow: 'hidden',
    fontFamily: 'Inter',
    backgroundColor: '#111418',
  };
  applyBackground(rootStyle, layout.background, ctx);

  const children = [];
  for (const el of layout.elements || []) {
    const node = elementNode(el, ctx);
    if (node) children.push(node);
  }
  return h('div', rootStyle, children);
}

/**
 * Render a story layout to a PNG on disk.
 * @returns {Promise<{url: string, mention: {username,x,y}|null}>}
 *   url      – public /uploads path of the rendered 9:16 image
 *   mention  – coords for an IG user_tags mention, or null if no mention element
 */
async function renderStoryToFile(opts) {
  const layout = opts.layout && typeof opts.layout === 'object' ? opts.layout : {};
  // Cap element count so a malicious/huge layout can't tie up the renderer.
  const elements = (Array.isArray(layout.elements) ? layout.elements : []).slice(0, 50);

  // Background image must be a local upload path — never an arbitrary URL from
  // the saved layout, which would let a client trigger server-side fetches (SSRF).
  const bgUrl = layout.background && layout.background.type === 'image'
    && typeof layout.background.url === 'string' && layout.background.url.startsWith('/uploads/')
    ? layout.background.url : null;

  const [photoUri, bgUri, avatarUri] = await Promise.all([
    toDataUri(opts.mediaUrls && opts.mediaUrls[0]),
    bgUrl ? toDataUri(bgUrl) : Promise.resolve(null),
    toDataUri(opts.avatarUrl),
  ]);

  const photoSize = localImageSize(opts.mediaUrls && opts.mediaUrls[0]);

  const ctx = {
    photoUri,
    bgUri,
    avatarUri,
    photoAspect: photoSize && photoSize.w ? photoSize.h / photoSize.w : null,
    caption: (opts.caption || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    displayName: opts.displayName || opts.username || '',
    username: opts.username || '',
  };

  const renderPng = async (els) => {
    const svg = await satori(buildTree({ ...layout, elements: els }, ctx), { width: W, height: H, fonts: FONTS });
    return new Resvg(svg, { background: '#111418', fitTo: { mode: 'width', value: W } }).render().asPng();
  };

  let png = await renderPng(elements);

  // Composite the real post photo into the card. Satori can't size an image
  // inside the card, so the card was rendered with a flat marker; we locate that
  // marker's rectangle and paint the photo into it with resvg (which places
  // images precisely). For rotated cards we measure on a rotation-0 pass, then
  // rotate the painted photo about the card centre to match.
  const postEl = elements.find((e) => e && e.type === 'post');
  if (postEl && photoUri) {
    const cardW = clamp01(postEl.width || 0.62) * W;
    const aspect = Math.max(0.6, Math.min(1.25, ctx.photoAspect || 0.82));
    const photoH = Math.round(cardW * aspect);
    const rot = Number.isFinite(postEl.rotation) ? postEl.rotation : 0;
    const cx = clamp01(postEl.x) * W;
    const cy = clamp01(postEl.y) * H;

    const measPng = rot === 0 ? png : await renderPng(elements.map((e) => (e === postEl ? { ...postEl, rotation: 0 } : e)));
    const bb = markerBBox(decodePng(measPng));
    if (bb) {
      const photoData = resizeToCover(photoUri, Math.round(cardW), photoH); // exact-size PNG
      const left = cx - cardW / 2;
      const top = bb.t;
      const baseUri = `data:image/png;base64,${png.toString('base64')}`;
      const grp = rot ? `<g transform="rotate(${rot} ${cx} ${cy})">` : '<g>';
      const composite = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">`
        + `<image xlink:href="${baseUri}" x="0" y="0" width="${W}" height="${H}"/>`
        + `${grp}<image xlink:href="${photoData}" x="${left - 1}" y="${top - 1}" width="${cardW + 2}" height="${photoH + 2}" preserveAspectRatio="xMidYMid slice"/></g></svg>`;
      png = new Resvg(composite, { background: '#111418', fitTo: { mode: 'width', value: W } }).render().asPng();
    }
  }

  const dir = path.join(__dirname, '../uploads/stories');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${uuidv4()}.png`;
  fs.writeFileSync(path.join(dir, filename), png);

  const mentionEl = elements.find((e) => e && e.type === 'mention');
  const mention = mentionEl && opts.username
    ? { username: opts.username, x: clamp01(mentionEl.x), y: clamp01(mentionEl.y) }
    : null;

  return { url: `/uploads/stories/${filename}`, mention };
}

module.exports = { renderStoryToFile, _internal: { buildTree, toDataUri, W, H } };
