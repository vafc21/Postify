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
