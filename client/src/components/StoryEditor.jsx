import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Type, AtSign, Upload, RotateCw, Trash2, X } from 'lucide-react';
import api from '../api';

const SERVER = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';
const CANVAS_W = 1080; // story design space; coords are stored normalized 0..1

// Background presets — the gradient/color strings are passed verbatim to the
// server renderer (Satori), so what you see here is what gets published.
const BACKGROUNDS = [
  { key: 'auto', label: 'Auto', bg: { type: 'auto' } },
  { key: 'g1', swatch: 'linear-gradient(165deg,#3b2f6b,#b5377e 52%,#ff8a5b)', bg: { type: 'gradient', value: 'linear-gradient(165deg,#3b2f6b,#b5377e 52%,#ff8a5b)' } },
  { key: 'g2', swatch: 'linear-gradient(160deg,#0f2027,#203a43,#2c5364)', bg: { type: 'gradient', value: 'linear-gradient(160deg,#0f2027,#203a43,#2c5364)' } },
  { key: 'g3', swatch: 'linear-gradient(160deg,#f7971e,#ffd200)', bg: { type: 'gradient', value: 'linear-gradient(160deg,#f7971e,#ffd200)' } },
  { key: 'dark', swatch: '#111418', bg: { type: 'color', value: '#111418' } },
  { key: 'white', swatch: '#ffffff', bg: { type: 'color', value: '#ffffff' } },
  { key: 'fb', swatch: '#1877F2', bg: { type: 'color', value: '#1877F2' } },
];

const TEXT_COLORS = ['#ffffff', '#111418', '#fa7e1e', '#d62976', '#1877F2', '#3fb950'];

let idCounter = 0;
const nextId = () => `el_${Date.now().toString(36)}_${idCounter++}`;

function defaultLayout() {
  return {
    version: 1,
    background: { type: 'gradient', value: 'linear-gradient(160deg,#f7971e,#ffd200)' },
    elements: [
      { id: 'post', type: 'post', x: 0.5, y: 0.42, width: 0.72, rotation: 0 },
      { id: 'mention', type: 'mention', x: 0.5, y: 0.78, rotation: 0, scale: 1 },
    ],
  };
}

export default function StoryEditor({ post, displayName, onClose, onChange }) {
  const initial = post.storyLayout && Array.isArray(post.storyLayout.elements) ? post.storyLayout : defaultLayout();
  const [background, setBackground] = useState(initial.background || { type: 'auto' });
  const [elements, setElements] = useState(initial.elements);
  const [platform, setPlatform] = useState('instagram');
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canvasRef = useRef(null);
  const [canvas, setCanvas] = useState({ w: 1, h: 1 });
  const fileRef = useRef();
  const interactionCleanup = useRef(null); // tears down an in-progress drag/rotate

  useLayoutEffect(() => {
    const measure = () => {
      if (canvasRef.current) {
        const r = canvasRef.current.getBoundingClientRect();
        setCanvas({ w: r.width, h: r.height });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // If the modal unmounts mid-drag, remove any still-bound window listeners.
  useLayoutEffect(() => () => interactionCleanup.current?.(), []);

  const scale = canvas.w / CANVAS_W; // px-per-design-unit
  const name = displayName || 'Your page';
  const photoUrl = post.mediaUrls?.[0] ? `${SERVER}${post.mediaUrls[0]}` : null;

  const updateEl = useCallback((id, patch) => {
    setElements((els) => els.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);
  const removeEl = (id) => {
    setElements((els) => els.filter((e) => e.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };

  // ── drag (delta-based, normalized) ──
  const startDrag = (e, el) => {
    if (el._editing) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(el.id);
    const startX = e.clientX, startY = e.clientY;
    const ox = el.x, oy = el.y;
    const move = (ev) => {
      if (canvas.w < 2 || canvas.h < 2) return; // not measured yet — avoid /1 jumps
      const nx = Math.max(0, Math.min(1, ox + (ev.clientX - startX) / canvas.w));
      const ny = Math.max(0, Math.min(1, oy + (ev.clientY - startY) / canvas.h));
      updateEl(el.id, { x: nx, y: ny });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      interactionCleanup.current = null;
    };
    interactionCleanup.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── rotate (drag the handle around the element center) ──
  const startRotate = (e, el, ref) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(el.id);
    const rect = ref.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const move = (ev) => {
      const deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      updateEl(el.id, { rotation: Math.round(deg) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      interactionCleanup.current = null;
    };
    interactionCleanup.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addText = () => {
    const el = { id: nextId(), type: 'text', x: 0.5, y: 0.2, rotation: 0, text: 'Your text', size: 56, color: '#ffffff', bold: true };
    setElements((els) => [...els, el]);
    setSelectedId(el.id);
  };
  const addMention = () => {
    if (elements.some((e) => e.type === 'mention')) {
      setSelectedId('mention');
      return;
    }
    const el = { id: 'mention', type: 'mention', x: 0.5, y: 0.74, rotation: 0 };
    setElements((els) => [...els, el]);
    setSelectedId(el.id);
  };

  const uploadBackground = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('asset', file);
      const { data } = await api.post(`/posts/${post.id}/story-asset`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setBackground({ type: 'image', url: data.url });
    } catch (err) {
      alert(err.response?.data?.error || 'Background upload failed');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      // Strip transient editor-only fields (e.g. _editing) before persisting.
      const clean = elements.map(({ _editing, ...e }) => e);
      const layout = { version: 1, background, elements: clean };
      const { data } = await api.put(`/posts/${post.id}`, { storyLayout: layout });
      onChange?.(data);
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save story');
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = async () => {
    if (!confirm('Reset this story to the default layout?')) return;
    const d = defaultLayout();
    setBackground(d.background);
    setElements(d.elements);
    setSelectedId(null);
  };

  const selected = elements.find((e) => e.id === selectedId) || null;

  // background style for the canvas
  const canvasBg = (() => {
    if (background.type === 'image' && background.url) return { backgroundImage: `url(${SERVER}${background.url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
    if (background.type === 'color') return { background: background.value };
    if (background.type === 'gradient') return { background: background.value };
    return { background: 'linear-gradient(165deg,#3b2f6b,#b5377e 52%,#ff8a5b)' }; // auto fallback look
  })();

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={sheet} onMouseDown={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={header}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>Edit story</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Drag to move · drag the ⟳ handle to rotate · double-click text to edit</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={onClose}>Cancel</button>
            <button style={{ ...btn, ...btnPrimary }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save story'}</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 18, padding: 18, minHeight: 0, flex: 1 }}>
          {/* canvas */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
            <div ref={canvasRef} style={{ ...canvasBox, ...canvasBg }} onMouseDown={() => setSelectedId(null)}>
              {/* auto background = post photo cover + scrim */}
              {background.type === 'auto' && photoUrl && (
                <>
                  <img src={photoUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,12,18,0.55)' }} />
                </>
              )}

              {elements.map((el) => (
                <EditableElement
                  key={el.id}
                  el={el}
                  selected={selectedId === el.id}
                  scale={scale}
                  name={name}
                  photoUrl={photoUrl}
                  caption={post.caption}
                  carousel={post.mediaType === 'carousel'}
                  platform={platform}
                  onSelect={() => setSelectedId(el.id)}
                  onDragStart={startDrag}
                  onRotateStart={startRotate}
                  onRemove={() => removeEl(el.id)}
                  onText={(text) => updateEl(el.id, { text })}
                  setEditing={(v) => updateEl(el.id, { _editing: v })}
                />
              ))}

              {/* story chrome hint */}
              <div style={chromeTop}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: platform === 'facebook' ? '#1877F2' : 'conic-gradient(from 200deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5,#feda75)', flexShrink: 0 }} />
                <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,.5)' }}>{platform === 'facebook' ? name : (displayName ? displayName.toLowerCase().replace(/\s+/g, '') : 'your_account')}</span>
              </div>
            </div>
          </div>

          {/* controls */}
          <div style={rail}>
            <Section title="Preview as">
              <div style={seg}>
                {['instagram', 'facebook'].map((p) => (
                  <button key={p} onClick={() => setPlatform(p)}
                    style={{ ...segBtn, ...(platform === p ? segOn(p) : {}) }}>
                    {p === 'instagram' ? 'Instagram' : 'Facebook'}
                  </button>
                ))}
              </div>
              {platform === 'facebook' && (
                <div style={hintBox}>On Facebook the story is image-only — the @mention is Instagram-only and won't be added here.</div>
              )}
            </Section>

            <Section title="Background">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button onClick={() => fileRef.current?.click()} title="Upload image" style={{ ...swatch, border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-3)' }}>
                  {uploading ? '…' : <Upload size={16} color="var(--text-muted)" />}
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadBackground(e.target.files?.[0])} />
                {BACKGROUNDS.map((b) => {
                  const active = (b.bg.type === background.type) && (b.bg.value === background.value || (b.bg.type === 'auto'));
                  return (
                    <button key={b.key} title={b.label || ''} onClick={() => setBackground(b.bg)}
                      style={{ ...swatch, background: b.swatch || 'linear-gradient(135deg,#3b2f6b,#b5377e,#ff8a5b)', outline: active ? '2px solid var(--text)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#fff' }}>
                      {b.key === 'auto' ? 'AUTO' : ''}
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title="Add to story">
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={addBtn} onClick={addText}><Type size={16} /> Text box</button>
                <button style={{ ...addBtn, opacity: platform === 'facebook' ? 0.45 : 1 }} disabled={platform === 'facebook'} onClick={addMention}>
                  <AtSign size={16} /> Mention
                </button>
              </div>
            </Section>

            <Section title="Selected element">
              {!selected && <div style={hintBox}>Click an element to edit it. Drag to move, drag the ⟳ handle to rotate. Double-click a text box to type.</div>}
              {selected && <ElementControls el={selected} onChange={(patch) => updateEl(selected.id, patch)} onRemove={() => removeEl(selected.id)} />}
            </Section>

            <button onClick={resetDefault} style={{ ...btn, width: '100%', marginTop: 'auto' }}>Reset to default</button>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10 }}>
              Carousel posts use the first image only. On save, this exact layout is rendered to a 9:16 image and published — Facebook image-only, Instagram adds the profile @mention.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableElement({ el, selected, scale, name, photoUrl, caption, carousel, platform, onSelect, onDragStart, onRotateStart, onRemove, onText, setEditing }) {
  const ref = useRef(null);
  const textRef = useRef(null);

  // Mention is Instagram-only; hide it in the Facebook preview.
  if (el.type === 'mention' && platform === 'facebook') return null;

  const wrap = {
    position: 'absolute',
    left: `${el.x * 100}%`,
    top: `${el.y * 100}%`,
    transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
    cursor: 'grab',
    outline: selected ? '2px dashed rgba(255,255,255,0.9)' : 'none',
    outlineOffset: 3,
    touchAction: 'none',
    userSelect: 'none',
  };

  const handles = selected && (
    <>
      <div onPointerDown={(e) => onRotateStart(e, el, ref.current)}
        style={{ position: 'absolute', top: -28, left: '50%', transform: 'translateX(-50%)', width: 20, height: 20, borderRadius: '50%', background: '#fff', color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', boxShadow: '0 2px 6px rgba(0,0,0,.3)' }}>
        <RotateCw size={11} />
      </div>
      <div onPointerDown={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ position: 'absolute', top: -12, right: -12, width: 20, height: 20, borderRadius: '50%', background: 'var(--danger)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '2px solid #fff' }}>
        <X size={11} />
      </div>
    </>
  );

  if (el.type === 'post') {
    // All inner dimensions are design-space px (matching server/storyRenderer.js)
    // multiplied by `scale`, so the preview is a true 1:1 mini of the output.
    const cardW = el.width * scale * CANVAS_W;
    return (
      <div ref={ref} style={{ ...wrap, width: cardW }} onPointerDown={(e) => onDragStart(e, el)} onClick={onSelect}>
        {handles}
        <div style={{ width: '100%', borderRadius: 26 * scale, overflow: 'hidden', background: '#fff', boxShadow: `0 ${24 * scale}px ${70 * scale}px rgba(0,0,0,.45)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 * scale, padding: `${18 * scale}px ${20 * scale}px` }}>
            <div style={{ width: 56 * scale, height: 56 * scale, borderRadius: '50%', background: '#1877F2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 * scale, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 26 * scale, fontWeight: 700, color: '#0a0a0a' }}>{name}</div>
              <div style={{ fontSize: 19 * scale, color: '#65676b' }}>2h</div>
            </div>
          </div>
          {photoUrl
            ? <img src={photoUrl} alt="" style={{ width: '100%', height: cardW * 0.82, objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: cardW * 0.82, background: 'linear-gradient(150deg,#f8b259,#ef6f53 45%,#b5377e)' }} />}
          {caption && <div style={{ padding: `${16 * scale}px ${20 * scale}px`, fontSize: 24 * scale, color: '#1c1e21', lineHeight: 1.35 }}>{caption.slice(0, 90)}</div>}
        </div>
      </div>
    );
  }

  if (el.type === 'mention') {
    const ms = el.scale || 1;
    return (
      <div ref={ref} style={wrap} onPointerDown={(e) => onDragStart(e, el)} onClick={onSelect}>
        {handles}
        <div style={{ background: 'rgba(0,0,0,0.55)', border: `${Math.max(1, 2 * scale * ms)}px solid rgba(255,255,255,0.25)`, borderRadius: 16 * scale * ms, padding: `${14 * scale * ms}px ${22 * scale * ms}px`, color: '#fff', fontSize: 30 * scale * ms, fontWeight: 700 }}>
          @{displayHandle(name)}
        </div>
      </div>
    );
  }

  // text
  return (
    <div ref={ref} style={wrap} onPointerDown={(e) => onDragStart(e, el)} onClick={onSelect}
      onDoubleClick={() => { setEditing(true); el._editing = true; textRef.current?.focus(); }}>
      {handles}
      <div
        ref={textRef}
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => { setEditing(false); el._editing = false; onText(e.currentTarget.textContent); }}
        style={{
          fontSize: (el.size || 56) * scale,
          fontWeight: el.bold === false ? 400 : 700,
          color: el.color || '#fff',
          textShadow: '0 2px 8px rgba(0,0,0,.45)',
          padding: '2px 6px',
          outline: 'none',
          whiteSpace: 'nowrap',
        }}>
        {el.text}
      </div>
    </div>
  );
}

function ElementControls({ el, onChange, onRemove }) {
  if (el.type === 'post') {
    return (
      <>
        <div style={hintBox}>Your feed post, composited so it looks like a native share. Pulled from this post automatically — drag to reposition.</div>
        <Field label={`Size · ${Math.round((el.width || 0.72) * 100)}%`}>
          <input type="range" min="30" max="100" value={Math.round((el.width || 0.72) * 100)} onChange={(e) => onChange({ width: Number(e.target.value) / 100 })} style={{ width: '100%', accentColor: 'var(--primary)' }} />
        </Field>
        <RotationField el={el} onChange={onChange} />
      </>
    );
  }
  if (el.type === 'mention') {
    return (
      <>
        <div style={hintBox}>Opens your profile when tapped on Instagram. Added automatically at publish.</div>
        <Field label={`Size · ${Math.round((el.scale || 1) * 100)}%`}>
          <input type="range" min="60" max="220" value={Math.round((el.scale || 1) * 100)} onChange={(e) => onChange({ scale: Number(e.target.value) / 100 })} style={{ width: '100%', accentColor: 'var(--primary)' }} />
        </Field>
        <RotationField el={el} onChange={onChange} />
        <button onClick={onRemove} style={dangerBtn}><Trash2 size={12} /> Remove mention</button>
      </>
    );
  }
  return (
    <>
      <Field label={`Size · ${el.size || 56}px`}>
        <input type="range" min="24" max="140" value={el.size || 56} onChange={(e) => onChange({ size: Number(e.target.value) })} style={{ width: '100%', accentColor: 'var(--primary)' }} />
      </Field>
      <Field label="Color">
        <div style={{ display: 'flex', gap: 8 }}>
          {TEXT_COLORS.map((c) => (
            <button key={c} onClick={() => onChange({ color: c })}
              style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: el.color === c ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>
      </Field>
      <Field label="Style">
        <button onClick={() => onChange({ bold: !(el.bold !== false) })}
          style={{ ...btn, fontWeight: el.bold !== false ? 700 : 400, borderColor: el.bold !== false ? 'var(--primary)' : 'var(--border)' }}>Bold</button>
      </Field>
      <RotationField el={el} onChange={onChange} />
      <button onClick={onRemove} style={dangerBtn}><Trash2 size={12} /> Delete text box</button>
    </>
  );
}

function RotationField({ el, onChange }) {
  return (
    <Field label={`Rotation · ${el.rotation || 0}°`}>
      <input type="range" min="-180" max="180" value={el.rotation || 0} onChange={(e) => onChange({ rotation: Number(e.target.value) })} style={{ width: '100%', accentColor: 'var(--primary)' }} />
    </Field>
  );
}

function displayHandle(name) {
  return name && name !== 'Your page' ? name.toLowerCase().replace(/\s+/g, '') : 'your_account';
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 9, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const sheet = { background: 'var(--bg-2)', borderRadius: 14, width: 'min(960px, 96vw)', height: 'min(720px, 94vh)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', overflow: 'hidden' };
const header = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' };
const canvasBox = { position: 'relative', width: 320, height: 569, borderRadius: 22, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.45)', flexShrink: 0 };
const chromeTop = { position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' };
const rail = { width: 300, flexShrink: 0, borderLeft: '1px solid var(--border)', paddingLeft: 18, display: 'flex', flexDirection: 'column', overflow: 'auto' };
const seg = { display: 'flex', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, gap: 4 };
const segBtn = { flex: 1, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: 13, padding: 7, borderRadius: 7, cursor: 'pointer' };
const segOn = (p) => ({ color: '#fff', background: p === 'facebook' ? '#1877F2' : 'linear-gradient(135deg,#fa7e1e,#d62976)' });
const swatch = { width: 38, height: 38, borderRadius: 9, border: '2px solid transparent', cursor: 'pointer' };
const addBtn = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px', borderRadius: 10, border: '1px dashed var(--border)', background: 'var(--bg-3)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btn = { borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)' };
const btnPrimary = { background: 'var(--primary)', color: '#fff', border: 'none' };
const dangerBtn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', borderRadius: 8, padding: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, marginTop: 4 };
const hintBox = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, background: 'var(--bg-3)', borderRadius: 8, padding: 10 };
