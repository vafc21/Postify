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

function backgroundLayer(bg, ctx) {
  const base = { position: 'absolute', top: 0, left: 0, width: W, height: H, display: 'flex' };
  if (bg && bg.type === 'image' && ctx.bgUri) {
    return img(ctx.bgUri, { ...base, objectFit: 'cover' });
  }
  if (bg && bg.type === 'color' && bg.value) {
    return h('div', { ...base, backgroundColor: bg.value });
  }
  if (bg && bg.type === 'gradient' && bg.value) {
    return h('div', { ...base, backgroundImage: bg.value });
  }
  // 'auto' (or anything unset): cover the post photo with a dark scrim for legibility
  if (ctx.photoUri) {
    return h('div', base, [
      img(ctx.photoUri, { position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' }),
      h('div', { position: 'absolute', top: 0, left: 0, width: W, height: H, backgroundColor: 'rgba(10,12,18,0.55)' }),
    ]);
  }
  return h('div', { ...base, backgroundImage: 'linear-gradient(165deg,#3b2f6b,#b5377e 52%,#ff8a5b)' });
}

function postCard(el, ctx) {
  const cardW = clamp01(el.width || 0.62) * W;
  // 4:5-ish landscape photo area with object-fit:cover. This ratio reliably
  // fills the width in Satori (a square box hit a Yoga sizing bug that left a
  // blank strip). cover crops top/bottom slightly; the width always fills.
  const photoH = Math.round(cardW * 0.82);
  const avatar = ctx.avatarUri
    ? img(ctx.avatarUri, { width: 56, height: 56, borderRadius: 28 })
    : h('div', { width: 56, height: 56, borderRadius: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1877F2', color: '#fff', fontSize: 26, fontWeight: 700 }, (ctx.displayName || '?').slice(0, 1).toUpperCase());

  const header = h('div', { display: 'flex', alignItems: 'center', padding: '18px 20px', width: '100%' }, [
    avatar,
    h('div', { display: 'flex', flexDirection: 'column', marginLeft: 14, flexGrow: 1 }, [
      h('div', { fontSize: 26, fontWeight: 700, color: '#0a0a0a' }, ctx.displayName || ''),
      h('div', { fontSize: 19, color: '#65676b' }, '2h'),
    ]),
    h('div', { fontSize: 30, color: '#65676b', fontWeight: 700 }, '···'),
  ]);

  // Image as a direct flex child with object-fit:cover — the original approach
  // that reliably fills the box. A square post (IG norm) fills the square area
  // exactly: no crop, no gap. Non-square posts center-fill like Instagram.
  const photo = ctx.photoUri
    ? img(ctx.photoUri, { width: cardW, height: photoH, objectFit: 'cover' })
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
  return placed(el, {
    backgroundColor: 'rgba(0,0,0,0.55)',
    border: '2px solid rgba(255,255,255,0.25)',
    borderRadius: 16,
    padding: '14px 22px',
  }, h('div', { fontSize: 30, fontWeight: 700, color: '#ffffff' }, `@${ctx.username || ''}`));
}

function elementNode(el, ctx) {
  if (!el || !el.type) return null;
  if (el.type === 'post') return postCard(el, ctx);
  if (el.type === 'text') return textBox(el);
  if (el.type === 'mention') return ctx.username ? mentionSticker(el, ctx) : null;
  return null;
}

function buildTree(layout, ctx) {
  const children = [backgroundLayer(layout.background, ctx)];
  for (const el of layout.elements || []) {
    const node = elementNode(el, ctx);
    if (node) children.push(node);
  }
  return h('div', {
    position: 'relative',
    width: W,
    height: H,
    display: 'flex',
    overflow: 'hidden',
    fontFamily: 'Inter',
    backgroundColor: '#111418',
  }, children);
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

  const ctx = {
    photoUri,
    bgUri,
    avatarUri,
    caption: (opts.caption || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    displayName: opts.displayName || opts.username || '',
    username: opts.username || '',
  };

  const svg = await satori(buildTree({ ...layout, elements }, ctx), { width: W, height: H, fonts: FONTS });
  const png = new Resvg(svg, { background: '#111418', fitTo: { mode: 'width', value: W } }).render().asPng();

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
