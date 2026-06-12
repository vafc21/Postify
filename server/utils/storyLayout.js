// Sanitizes a story layout submitted from the editor before it's persisted.
// Whitelists element types + fields so the stored layout can only contain what
// the flat renderer (services/storyRenderer.js) and the Storrito HTML builder
// (services/storrito.js) know how to handle. Pure + dependency-light so it can
// be unit-tested directly.
const { STICKER_VARIANTS } = require('../services/storrito');

const BG_TYPES = new Set(['auto', 'color', 'gradient', 'image']);
// `link`/`hashtag`/`poll`/`location` are NATIVE interactive stickers — they can't
// be drawn into a flat image, so a layout containing one routes publishing through
// Storrito (see services/storrito.js layoutHasNativeStickers). On the Graph path
// they're simply ignored, so adding them never breaks a non-Storrito client's story.
const EL_TYPES = new Set(['post', 'text', 'mention', 'link', 'hashtag', 'poll', 'location']);
const TEXT_ALIGN = new Set(['left', 'center', 'right']);

const num = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

// Clamp a sticker's style variant (design/color) to its allowed enum, mirroring
// services/storrito.js so a saved value always matches what gets published.
function cleanVariant(type, e) {
  const v = STICKER_VARIANTS[type];
  if (!v) return undefined;
  const raw = e[v.attr];
  return (typeof raw === 'string' && v.allowed.includes(raw)) ? raw : v.def;
}

function sanitizeStoryLayout(input) {
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid story layout');

  const bgIn = input.background && typeof input.background === 'object' ? input.background : {};
  const bgType = BG_TYPES.has(bgIn.type) ? bgIn.type : 'auto';
  const background = { type: bgType };
  if (bgType === 'color' || bgType === 'gradient') background.value = typeof bgIn.value === 'string' ? bgIn.value.slice(0, 400) : '';
  if (bgType === 'image') background.url = typeof bgIn.url === 'string' && bgIn.url.startsWith('/uploads/') ? bgIn.url : null;

  const elements = (Array.isArray(input.elements) ? input.elements : [])
    .slice(0, 50)
    .filter((e) => e && EL_TYPES.has(e.type))
    .map((e) => {
      const el = { type: e.type, x: num(e.x, 0, 1, 0.5), y: num(e.y, 0, 1, 0.5), rotation: num(e.rotation, -360, 360, 0) };
      if (typeof e.id === 'string') el.id = e.id.slice(0, 40);
      if (e.type === 'post') el.width = num(e.width, 0.2, 1, 0.72);
      if (e.type === 'mention') {
        el.scale = num(e.scale, 0.6, 2.2, 1);
        if (typeof e.username === 'string') el.username = e.username.slice(0, 40).replace(/^@/, '');
        el.design = cleanVariant('mention', e);
      }
      if (e.type === 'text') {
        el.text = String(e.text || '').slice(0, 200);
        el.size = num(e.size, 8, 200, 56);
        el.color = typeof e.color === 'string' ? e.color.slice(0, 32) : '#ffffff';
        el.bold = e.bold !== false;
        el.align = TEXT_ALIGN.has(e.align) ? e.align : 'center';
      }
      // Native interactive stickers (Storrito-only). Only http(s) link URLs are
      // accepted — the same SSRF guard the rest of the layout uses.
      if (e.type === 'link') {
        el.url = typeof e.url === 'string' && /^https?:\/\//i.test(e.url) ? e.url.slice(0, 400) : '';
        el.text = String(e.text || e.label || '').slice(0, 60); // editor stores the label in `text`
        el.design = cleanVariant('link', e);
      }
      if (e.type === 'hashtag') {
        el.tag = String(e.tag || '').slice(0, 100).replace(/^#/, '');
        el.design = cleanVariant('hashtag', e);
      }
      if (e.type === 'poll') {
        el.question = String(e.question || '').slice(0, 120);
        const opts = Array.isArray(e.options) ? e.options.slice(0, 4).map((o) => String(o || '').slice(0, 40)) : [];
        el.options = opts.length >= 2 ? opts : ['Yes', 'No'];
        el.color = cleanVariant('poll', e);
      }
      if (e.type === 'location') {
        el.location = String(e.location || '').slice(0, 100);
        if (typeof e.locationId === 'string' && e.locationId) el.locationId = e.locationId.slice(0, 60);
        el.design = cleanVariant('location', e);
      }
      return el;
    });

  return { version: 1, background, elements };
}

module.exports = { sanitizeStoryLayout, EL_TYPES, BG_TYPES };
