# Storrito Interactive Story Stickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Storrito's interactive Instagram-story stickers (link, hashtag, poll, location) — with full style variants — to the Story Editor, gated to the Instagram + Storrito path.

**Architecture:** A self-contained client registry module (`storyStickers.jsx`) defines each sticker's default, preview, controls, and variant styles; `StoryEditor.jsx` consumes the registry for its palette/preview/controls. The server's `buildInstaStoryHtml` already emits the `<insta-*>` components — this plan adds the variant attributes and the `location` routing. Stickers are Instagram-only and disabled unless Storrito is connected for the client.

**Tech Stack:** React (Vite) client; Node/Express + Prisma server; Jest (server) for tests; Satori-based flat renderer (untouched).

**Spec:** [docs/superpowers/specs/2026-06-12-storrito-story-stickers-design.md](../specs/2026-06-12-storrito-story-stickers-design.md)

---

## File Structure

- **Create** `client/src/components/storyStickers.jsx` — the sticker registry: `STICKERS`, `STICKER_ORDER`, `VARIANTS`, `POLL_COLORS`, `DesignPicker`, and per-sticker `makeDefault`/`Preview`/`Controls`. Editor-only; does not duplicate the server's layout→HTML mapping.
- **Modify** `client/src/components/StoryEditor.jsx` — palette buttons, canvas-preview dispatch, controls dispatch, `mention` design picker, and Storrito gating via `useAuth()`.
- **Modify** `server/services/storrito.js` — variant attributes in `buildInstaStoryHtml`; read link label from `text`; add `location` to `STORRITO_ONLY_TYPES`.
- **Modify** `server/routes/posts.js` — include `storritoUsername` on the campaign-posts client select (so the editor can gate).
- **Create** `server/tests/storrito.test.js` — unit tests for the variant HTML + location routing.
- **Verify only** `server/services/storyRenderer.js` — already returns `null` for unknown element types ([:270](../../../server/services/storyRenderer.js)); no change.

**Client testing note:** the client has no Jest/Vitest harness, so client tasks are verified by a Vite production build (`cd client && npm run build`, catches import/syntax/JSX errors) plus the manual app-run checklist in Task 5. Adding a client test runner is out of scope. The correctness-critical logic (layout→Storrito HTML) is covered by real Jest tests on the server in Task 1–2.

---

## Task 1: Server — variant attributes in `buildInstaStoryHtml`

**Files:**
- Modify: `server/services/storrito.js`
- Test: `server/tests/storrito.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/tests/storrito.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest tests/storrito.test.js -t "variant attributes" -v`
Expected: FAIL — the `design=`/`color=` assertions fail (current code emits no variant attributes), and the link test fails because the code reads `el.label`, not `el.text`.

- [ ] **Step 3: Add the variant map + helper**

In `server/services/storrito.js`, immediately after the `STORY_DIMENSIONS` constant (around line 30), add:

```js
// Per-sticker style variant: which attribute carries it, the allowed values, and
// the default (omitted from the HTML). MUST mirror the client VARIANTS in
// client/src/components/storyStickers.jsx.
const STICKER_VARIANTS = {
  link:     { attr: 'design', allowed: ['default', 'gray', 'black', 'rainbow'], def: 'default' },
  hashtag:  { attr: 'design', allowed: ['default', 'gray', 'rainbow'], def: 'default' },
  mention:  { attr: 'design', allowed: ['default', 'gray', 'rainbow'], def: 'default' },
  location: { attr: 'design', allowed: ['default', 'gray', 'black', 'orange', 'rainbow'], def: 'default' },
  poll:     { attr: 'color', allowed: ['black', 'pink', 'lavender', 'purple', 'orange', 'green', 'blue'], def: 'black' },
};

// Returns e.g. ` design="gray"` for a valid non-default variant, else '' (the
// default and any unrecognized value are omitted to keep the HTML clean).
function variantAttr(type, el) {
  const v = STICKER_VARIANTS[type];
  if (!v) return '';
  const raw = el[v.attr];
  if (!raw || raw === v.def || !v.allowed.includes(raw)) return '';
  return ` ${v.attr}="${raw}"`;
}
```

- [ ] **Step 4: Emit the variant attribute (and fix link `text`) in the sticker loop**

In `buildInstaStoryHtml`, replace the existing `for (const el of (layout?.elements || []))` loop body with:

```js
  const stickers = [];
  for (const el of (layout?.elements || [])) {
    if (!el) continue;
    if (el.type === 'link' && el.url) {
      const label = el.text || el.label; // editor stores the label in `text`
      const text = label ? ` text="${esc(label)}"` : '';
      stickers.push(`<insta-link style="${at(el)}" url="${esc(el.url)}"${text}${variantAttr('link', el)}></insta-link>`);
    } else if (el.type === 'hashtag' && el.tag) {
      stickers.push(`<insta-hashtag style="${at(el)}" hashtag="${esc(String(el.tag).replace(/^#/, ''))}"${variantAttr('hashtag', el)}></insta-hashtag>`);
    } else if (el.type === 'poll' && el.question) {
      const opts = (Array.isArray(el.options) && el.options.length >= 2 ? el.options : ['Yes', 'No'])
        .slice(0, 4).map((o) => String(o));
      stickers.push(`<insta-poll style="${at(el)}" question="${esc(el.question)}" options="${esc(JSON.stringify(opts))}"${variantAttr('poll', el)}></insta-poll>`);
    } else if (el.type === 'mention' && (el.username || fallbackMentionUsername)) {
      stickers.push(`<insta-mention style="${at(el)}" username="${esc((el.username || fallbackMentionUsername).replace(/^@/, ''))}"${variantAttr('mention', el)}></insta-mention>`);
    } else if (el.type === 'location' && el.location) {
      const locId = el.locationId ? ` location-id="${esc(el.locationId)}"` : '';
      stickers.push(`<insta-location style="${at(el)}" location="${esc(el.location)}"${locId}${variantAttr('location', el)}></insta-location>`);
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx jest tests/storrito.test.js -t "variant attributes" -v`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/services/storrito.js server/tests/storrito.test.js
git commit -m "feat(storrito): emit sticker style variants in buildInstaStoryHtml"
```

---

## Task 2: Server — route location-only stories through Storrito

**Files:**
- Modify: `server/services/storrito.js:24` (the `STORRITO_ONLY_TYPES` set)
- Test: `server/tests/storrito.test.js`

- [ ] **Step 1: Write the failing test**

Append to `server/tests/storrito.test.js`:

```js
describe('location routing', () => {
  test('location is a Storrito-only type', () => {
    expect(STORRITO_ONLY_TYPES.has('location')).toBe(true);
  });
  test('a location-only layout has native stickers', () => {
    expect(layoutHasNativeStickers(layout([{ type: 'location', location: 'Cologne' }]))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest tests/storrito.test.js -t "location routing" -v`
Expected: FAIL — `STORRITO_ONLY_TYPES.has('location')` is `false`.

- [ ] **Step 3: Add `location` to the set**

In `server/services/storrito.js`, change the `STORRITO_ONLY_TYPES` definition (line 24) from:

```js
const STORRITO_ONLY_TYPES = new Set(['link', 'hashtag', 'poll']);
```

to:

```js
const STORRITO_ONLY_TYPES = new Set(['link', 'hashtag', 'poll', 'location']);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest tests/storrito.test.js -v`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add server/services/storrito.js server/tests/storrito.test.js
git commit -m "feat(storrito): route location-sticker stories through Storrito"
```

---

## Task 3: Server — expose `storritoUsername` on campaign posts

**Files:**
- Modify: `server/routes/posts.js` (the `GET /campaign/:id` handler's `client` select, near line 258)

- [ ] **Step 1: Locate the handler**

Run: `cd server && grep -n "businessName: true" routes/posts.js`
Expected: a line inside `include: { client: { select: { id: true, name: true, businessName: true } } }` for the `/campaign/:id` route (the one CampaignView calls via `GET /posts/campaign/:id`).

- [ ] **Step 2: Add `storritoUsername` to the select**

Change that `client` select from:

```js
      include: { client: { select: { id: true, name: true, businessName: true } } },
```

to:

```js
      include: { client: { select: { id: true, name: true, businessName: true, storritoUsername: true } } },
```

- [ ] **Step 3: Verify the server still boots and returns the field**

Run: `cd server && node --check routes/posts.js && echo OK`
Expected: `OK` (syntax valid). The field now rides along on each post's `client` for the editor to read.

- [ ] **Step 4: Commit**

```bash
git add server/routes/posts.js
git commit -m "feat(posts): include client.storritoUsername on campaign posts for sticker gating"
```

---

## Task 4: Client — create the sticker registry `storyStickers.jsx`

**Files:**
- Create: `client/src/components/storyStickers.jsx`

- [ ] **Step 1: Create the file with the full registry**

```jsx
import { Link2, Hash, BarChart3, MapPin, Plus, Trash2 } from 'lucide-react';

// Variant option lists — MUST mirror server/services/storrito.js STICKER_VARIANTS.
export const VARIANTS = {
  link: ['default', 'gray', 'black', 'rainbow'],
  hashtag: ['default', 'gray', 'rainbow'],
  mention: ['default', 'gray', 'rainbow'],
  location: ['default', 'gray', 'black', 'orange', 'rainbow'],
};
export const POLL_COLORS = ['black', 'pink', 'lavender', 'purple', 'orange', 'green', 'blue'];

// variant key -> chip look (background + text color). 'rainbow' is a gradient.
const CHIP_LOOK = {
  default: { background: '#ffffff', color: '#111418' },
  gray: { background: 'rgba(255,255,255,0.55)', color: '#111418' },
  black: { background: '#111418', color: '#ffffff' },
  orange: { background: '#fa7e1e', color: '#ffffff' },
  rainbow: { background: 'linear-gradient(90deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)', color: '#ffffff' },
};
const POLL_ACCENT = {
  black: '#111418', pink: '#d62976', lavender: '#b57edc', purple: '#962fbf', orange: '#fa7e1e', green: '#3fb950', blue: '#4f5bd5',
};

const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)', fontSize: 13 };
const iconBtn = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--danger)', borderRadius: 8, cursor: 'pointer' };
const addOptBtn = { display: 'flex', alignItems: 'center', gap: 5, border: '1px dashed var(--border)', background: 'var(--bg-3)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' };

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// Square swatch picker for `design` variants (used by stickers + the mention control).
export function DesignPicker({ type, value, onChange }) {
  const opts = VARIANTS[type] || [];
  return (
    <Field label="Style">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {opts.map((o) => (
          <button key={o} title={o} onClick={() => onChange(o)}
            style={{ width: 26, height: 26, borderRadius: 7, cursor: 'pointer', background: (CHIP_LOOK[o] || CHIP_LOOK.default).background, border: value === o ? '2px solid var(--text)' : '2px solid transparent' }} />
        ))}
      </div>
    </Field>
  );
}

function Pill({ scale, look, children }) {
  return (
    <div style={{ ...(look || CHIP_LOOK.default), borderRadius: 14 * scale, padding: `${10 * scale}px ${18 * scale}px`, fontSize: 28 * scale, fontWeight: 800, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 * scale, boxShadow: '0 2px 10px rgba(0,0,0,.25)' }}>
      {children}
    </div>
  );
}

function PollControls({ el, onChange }) {
  const options = el.options && el.options.length >= 2 ? el.options : ['Yes', 'No'];
  const setOpt = (i, v) => onChange({ options: options.map((o, j) => (j === i ? v : o)) });
  const addOpt = () => { if (options.length < 4) onChange({ options: [...options, ''] }); };
  const removeOpt = (i) => { if (options.length > 2) onChange({ options: options.filter((_, j) => j !== i) }); };
  return (
    <>
      <Field label="Question"><input style={inp} value={el.question || ''} onChange={(e) => onChange({ question: e.target.value })} /></Field>
      <Field label="Options (2–4)">
        {options.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input style={inp} value={o} onChange={(e) => setOpt(i, e.target.value)} />
            {options.length > 2 && <button style={iconBtn} onClick={() => removeOpt(i)}><Trash2 size={12} /></button>}
          </div>
        ))}
        {options.length < 4 && <button style={addOptBtn} onClick={addOpt}><Plus size={12} /> Add option</button>}
      </Field>
      <Field label="Color">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {POLL_COLORS.map((c) => (
            <button key={c} title={c} onClick={() => onChange({ color: c })}
              style={{ width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', background: POLL_ACCENT[c], border: el.color === c ? '2px solid var(--text)' : '2px solid transparent' }} />
          ))}
        </div>
      </Field>
    </>
  );
}

// Each entry: makeDefault() returns the element WITHOUT id (StoryEditor assigns it).
export const STICKERS = {
  link: {
    type: 'link', label: 'Link', icon: Link2,
    makeDefault: () => ({ type: 'link', x: 0.5, y: 0.62, rotation: 0, url: '', text: '', design: 'default' }),
    Preview: ({ el, scale }) => (
      <Pill scale={scale} look={CHIP_LOOK[el.design]}><Link2 size={20 * scale} /> {el.text || el.url || 'Link'}</Pill>
    ),
    Controls: ({ el, onChange }) => (
      <>
        <Field label="URL"><input style={inp} value={el.url || ''} placeholder="https://example.com" onChange={(e) => onChange({ url: e.target.value })} /></Field>
        <Field label="Label (optional)"><input style={inp} value={el.text || ''} placeholder="Link" onChange={(e) => onChange({ text: e.target.value })} /></Field>
        <DesignPicker type="link" value={el.design} onChange={(d) => onChange({ design: d })} />
      </>
    ),
  },
  hashtag: {
    type: 'hashtag', label: 'Hashtag', icon: Hash,
    makeDefault: () => ({ type: 'hashtag', x: 0.5, y: 0.5, rotation: 0, tag: '', design: 'default' }),
    Preview: ({ el, scale }) => (
      <Pill scale={scale} look={CHIP_LOOK[el.design]}>#{(el.tag || 'hashtag').replace(/^#/, '')}</Pill>
    ),
    Controls: ({ el, onChange }) => (
      <>
        <Field label="Hashtag"><input style={inp} value={el.tag || ''} placeholder="travel" onChange={(e) => onChange({ tag: e.target.value.replace(/^#/, '') })} /></Field>
        <DesignPicker type="hashtag" value={el.design} onChange={(d) => onChange({ design: d })} />
      </>
    ),
  },
  poll: {
    type: 'poll', label: 'Poll', icon: BarChart3,
    makeDefault: () => ({ type: 'poll', x: 0.5, y: 0.45, rotation: 0, question: 'Ask a question…', options: ['Yes', 'No'], color: 'black' }),
    Preview: ({ el, scale }) => (
      <div style={{ width: 300 * scale, borderRadius: 20 * scale, overflow: 'hidden', background: 'rgba(255,255,255,0.92)', boxShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
        <div style={{ padding: `${12 * scale}px`, fontSize: 24 * scale, fontWeight: 800, color: '#111418', textAlign: 'center' }}>{el.question || 'Poll'}</div>
        <div style={{ display: 'flex' }}>
          {(el.options && el.options.length >= 2 ? el.options : ['Yes', 'No']).slice(0, 4).map((o, i) => (
            <div key={i} style={{ flex: 1, padding: `${12 * scale}px`, fontSize: 22 * scale, fontWeight: 700, textAlign: 'center', color: POLL_ACCENT[el.color] || '#111418', borderTop: `${2 * scale}px solid rgba(0,0,0,.08)`, borderLeft: i ? `${2 * scale}px solid rgba(0,0,0,.08)` : 'none' }}>{o || ' '}</div>
          ))}
        </div>
      </div>
    ),
    Controls: ({ el, onChange }) => <PollControls el={el} onChange={onChange} />,
  },
  location: {
    type: 'location', label: 'Location', icon: MapPin,
    makeDefault: () => ({ type: 'location', x: 0.5, y: 0.3, rotation: 0, location: '', locationId: '', design: 'default' }),
    Preview: ({ el, scale }) => (
      <Pill scale={scale} look={CHIP_LOOK[el.design]}><MapPin size={20 * scale} /> {el.location || 'Location'}</Pill>
    ),
    Controls: ({ el, onChange }) => (
      <>
        <Field label="Location name"><input style={inp} value={el.location || ''} placeholder="Cologne" onChange={(e) => onChange({ location: e.target.value })} /></Field>
        <Field label="Instagram location ID (optional)"><input style={inp} value={el.locationId || ''} onChange={(e) => onChange({ locationId: e.target.value })} /></Field>
        <DesignPicker type="location" value={el.design} onChange={(d) => onChange({ design: d })} />
      </>
    ),
  },
};

export const STICKER_ORDER = ['link', 'hashtag', 'poll', 'location'];
```

- [ ] **Step 2: Verify it compiles**

Run: `cd client && npm run build`
Expected: build succeeds (no unresolved imports / JSX errors). The module isn't imported anywhere yet, so this only proves it parses and its imports (all from `lucide-react`) resolve.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/storyStickers.jsx
git commit -m "feat(editor): add Storrito sticker registry (link/hashtag/poll/location)"
```

---

## Task 5: Client — wire the registry into `StoryEditor.jsx`

**Files:**
- Modify: `client/src/components/StoryEditor.jsx`

- [ ] **Step 1: Add imports**

At the top of `client/src/components/StoryEditor.jsx`, after the existing `import api from '../api';` line, add:

```jsx
import { useAuth } from '../contexts/AuthContext';
import { STICKERS, STICKER_ORDER, DesignPicker } from './storyStickers';
```

- [ ] **Step 2: Compute `storritoReady` and an `addSticker` handler**

Inside the `StoryEditor` component, right after the existing `const [uploading, setUploading] = useState(false);` line, add:

```jsx
  const { user } = useAuth();
  // Interactive stickers are Instagram + Storrito only: the operator must have
  // Storrito creds AND this client must be linked in Storrito.
  const storritoReady = !!(user?.storritoConfigured && post.client?.storritoUsername);
```

Then, right after the existing `addMention` function, add:

```jsx
  const addSticker = (key) => {
    const el = { ...STICKERS[key].makeDefault(), id: nextId() };
    setElements((els) => [...els, el]);
    setSelectedId(el.id);
  };
```

- [ ] **Step 3: Add the sticker palette (Instagram-only, gated)**

In the JSX, replace the entire `<Section title="Add to story">…</Section>` block with:

```jsx
            <Section title="Add to story">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button style={addBtn} onClick={addText}><Type size={16} /> Text box</button>
                <button style={{ ...addBtn, opacity: platform === 'facebook' ? 0.45 : 1 }} disabled={platform === 'facebook'} onClick={addMention}>
                  <AtSign size={16} /> Mention
                </button>
                {platform === 'instagram' && STICKER_ORDER.map((k) => {
                  const S = STICKERS[k];
                  const Icon = S.icon;
                  return (
                    <button key={k} style={{ ...addBtn, opacity: storritoReady ? 1 : 0.45 }} disabled={!storritoReady}
                      title={storritoReady ? '' : 'Connect Storrito to use interactive stickers'} onClick={() => addSticker(k)}>
                      <Icon size={16} /> {S.label}
                    </button>
                  );
                })}
              </div>
              {platform === 'instagram' && !storritoReady && (
                <div style={{ ...hintBox, marginTop: 8 }}>Interactive stickers publish through Storrito — connect it in Settings and link this client to enable.</div>
              )}
            </Section>
```

- [ ] **Step 4: Render sticker previews in `EditableElement`**

In `EditableElement`, just below the existing mention guard line `if (el.type === 'mention' && platform === 'facebook') return null;`, add a guard so stickers never show on the Facebook canvas:

```jsx
  // Interactive Storrito stickers are Instagram-only.
  if (STICKERS[el.type] && platform === 'facebook') return null;
```

Then, immediately before the final `// text` return block (the `return ( <div ref={ref} style={wrap} … onDoubleClick …`), add:

```jsx
  const sticker = STICKERS[el.type];
  if (sticker) {
    const SPreview = sticker.Preview;
    return (
      <div ref={ref} style={wrap} onPointerDown={(e) => onDragStart(e, el)} onClick={onSelect}>
        {handles}
        <SPreview el={el} scale={scale} />
      </div>
    );
  }
```

- [ ] **Step 5: Render sticker controls in `ElementControls` + add `mention` design picker**

In `ElementControls`, inside the existing `if (el.type === 'mention')` branch, add a design picker right before the `<RotationField … />` line:

```jsx
        <DesignPicker type="mention" value={el.design} onChange={(d) => onChange({ design: d })} />
```

Then, immediately before the final text-control `return (` (the one starting `<Field label={`Size · ${el.size || 56}px`}>`), add:

```jsx
  const sticker = STICKERS[el.type];
  if (sticker) {
    const SControls = sticker.Controls;
    return (
      <>
        <SControls el={el} onChange={onChange} />
        <RotationField el={el} onChange={onChange} />
        <button onClick={onRemove} style={dangerBtn}><Trash2 size={12} /> Delete {sticker.label.toLowerCase()}</button>
      </>
    );
  }
```

- [ ] **Step 6: Verify it compiles**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Manual verification in the app**

Run the app (`npm run dev` from repo root), open a campaign post → **Edit story**, then confirm:
- With Storrito **connected** for the client (operator creds set + client `storritoUsername`): Link/Hashtag/Poll/Location buttons are enabled on the **Instagram** tab; each adds a sticker, is draggable/rotatable, and its controls (content + style/color) update the preview. Poll lets you edit the question and 2–4 options.
- Switch to the **Facebook** tab: the four sticker buttons are gone and any IG stickers are not shown.
- With Storrito **not connected**: the four buttons are disabled and the "publish through Storrito" notice shows.
- **Save story**, reopen: stickers persist. (Optionally inspect the saved layout: `Network` tab → the `PUT /posts/:id` request body `storyLayout.elements`.)
- The existing `mention` sticker now has a **Style** picker.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/StoryEditor.jsx
git commit -m "feat(editor): wire Storrito stickers into the story editor with gating"
```

---

## Notes for the implementer

- **Keep client `VARIANTS` and server `STICKER_VARIANTS` in sync.** They're the same enums in two runtimes (no shared module across client/server); a value added in one must be added in the other.
- **`makeDefault()` returns no `id`** — `StoryEditor.addSticker` assigns it via the editor's `nextId()`. Don't add an `id` inside the registry.
- **Don't touch the flat renderer.** `storyRenderer.js` intentionally ignores these types; the interactive look comes only from Storrito.
- **Facebook stays sticker-free** by design — every sticker palette button and canvas preview is guarded by `platform === 'instagram'`.
