import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api';

const PRESETS = [
  { key: 'brand_awareness', name: 'Brand Awareness', desc: '1× daily — pick the time', frequency: 'daily', timesPerCycle: 1, scheduleConfig: { times: ['09:00'] } },
  { key: 'daily_tips', name: 'Daily Tips', desc: '1× daily — pick the time', frequency: 'daily', timesPerCycle: 1, scheduleConfig: { times: ['09:00'] } },
  { key: 'weekly_highlight', name: 'Weekly Highlight', desc: '1× weekly — pick day & time', frequency: 'weekly', timesPerCycle: 1, scheduleConfig: { days: ['friday'], time: '12:00' } },
  { key: 'product_launch', name: 'Product Launch', desc: '3× daily — pick the times', frequency: 'daily', timesPerCycle: 3, scheduleConfig: { times: ['09:00', '13:00', '18:00'] } },
  { key: 'monthly_recap', name: 'Monthly Recap', desc: '1× monthly — pick date & time', frequency: 'monthly', timesPerCycle: 1, scheduleConfig: { date: 1, time: '10:00' } },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function defaultEndDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export default function CampaignWizard({ clientId, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '', description: '',
    type: 'custom', presetTemplate: '',
    frequency: 'daily', timesPerCycle: 1,
    scheduleConfig: { times: ['09:00'] },
    postToInstagram: true, postToFacebook: true, postToStory: true,
    endDate: defaultEndDate(),
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const isPreset = form.type === 'preset';
  const totalSteps = isPreset ? 4 : 5;
  // Presets skip step 3 (frequency picker); remaining steps shift up by 1
  const visibleStep = isPreset && step >= 4 ? step - 1 : step;

  const next = () => {
    if (step === 1) {
      if (!form.name.trim()) return setError('Campaign name is required');
      if (!form.endDate) return setError('End date is required');
      if (new Date(form.endDate) <= new Date()) return setError('End date must be in the future');
    }
    if (step === 2 && isPreset && !form.presetTemplate) return setError('Pick a template or choose Custom');
    setError('');
    // Presets pick the frequency for you — jump from step 2 (type) straight to step 4 (times)
    if (step === 2 && isPreset) return setStep(4);
    setStep(s => Math.min(s + 1, 5));
  };
  const back = () => {
    setError('');
    if (step === 4 && isPreset) return setStep(2);
    setStep(s => Math.max(s - 1, 1));
  };

  const handleSubmit = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.post(`/clients/${clientId}/campaigns`, form);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  const updateTime = (index, value) => {
    const times = [...(form.scheduleConfig.times || [])];
    times[index] = value;
    set('scheduleConfig', { ...form.scheduleConfig, times });
  };

  const addTime = () => {
    const times = [...(form.scheduleConfig.times || []), '12:00'];
    set('scheduleConfig', { ...form.scheduleConfig, times });
    set('timesPerCycle', times.length);
  };

  const removeTime = (index) => {
    const times = (form.scheduleConfig.times || []).filter((_, i) => i !== index);
    set('scheduleConfig', { ...form.scheduleConfig, times });
    set('timesPerCycle', Math.max(1, times.length));
  };

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>New Campaign — Step {visibleStep} of {totalSteps}</span>
          <button onClick={onClose} style={iconBtn}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: s <= visibleStep ? 'var(--primary)' : 'var(--border)' }} />
          ))}
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Label>Campaign Name *</Label>
            <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Summer Promo" autoFocus />
            <Label>Description</Label>
            <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional..." />
            <Label>End Date *</Label>
            <input type="date" style={inputStyle} value={form.endDate} onChange={e => set('endDate', e.target.value)} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} />
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Defaults to one month from today. You can change this anytime after creating the campaign.</div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Choose a type</Label>
            <div onClick={() => setForm(f => ({ ...f, type: 'custom', presetTemplate: '' }))} style={optionCard(form.type === 'custom')}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>✏️ Custom Campaign</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Build your own schedule from scratch</div>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, margin: '8px 0 4px', textTransform: 'uppercase' }}>Preset Templates</div>
            {PRESETS.map(p => (
              <div key={p.key} onClick={() => {
                setForm(f => ({
                  ...f,
                  type: 'preset',
                  presetTemplate: p.key,
                  frequency: p.frequency,
                  timesPerCycle: p.timesPerCycle,
                  scheduleConfig: p.scheduleConfig,
                }));
              }} style={optionCard(form.type === 'preset' && form.presetTemplate === p.key)}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>📋 {p.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>How often should posts go out?</Label>
            {['daily', 'weekly', 'monthly'].map(f => (
              <div key={f} onClick={() => {
                set('frequency', f);
                if (f === 'daily') set('scheduleConfig', { times: ['09:00'] });
                if (f === 'weekly') set('scheduleConfig', { days: ['friday'], time: '12:00' });
                if (f === 'monthly') set('scheduleConfig', { date: 1, time: '10:00' });
              }} style={optionCard(form.frequency === f)}>
                <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{f}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {f === 'daily' && '1–5× per day at set times'}
                  {f === 'weekly' && 'Pick day(s) and time'}
                  {f === 'monthly' && 'Pick date number and time'}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Label>{isPreset ? `Customize ${PRESETS.find(p => p.key === form.presetTemplate)?.name || ''} schedule` : 'Set your schedule'}</Label>
            {isPreset && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Pre-filled from the template — adjust the times to fit your client.
              </div>
            )}
            {form.frequency === 'daily' && (
              <>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Post times (each day):</div>
                {(form.scheduleConfig.times || []).map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="time" style={{ ...inputStyle, width: 'auto' }} value={t} onChange={e => updateTime(i, e.target.value)} />
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Post {i + 1}</span>
                    {(form.scheduleConfig.times?.length || 0) > 1 && (
                      <button onClick={() => removeTime(i)} style={ghostSmallBtn}>✕</button>
                    )}
                  </div>
                ))}
                {(form.scheduleConfig.times?.length || 0) < 5 && (
                  <button onClick={addTime} style={ghostBtn}>+ Add another time</button>
                )}
              </>
            )}
            {form.frequency === 'weekly' && (
              <>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Day(s) of the week:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {DAYS.map(day => {
                    const key = day.toLowerCase();
                    const selected = (form.scheduleConfig.days || []).includes(key);
                    return (
                      <div key={day} onClick={() => {
                        const days = selected
                          ? (form.scheduleConfig.days || []).filter(d => d !== key)
                          : [...(form.scheduleConfig.days || []), key];
                        set('scheduleConfig', { ...form.scheduleConfig, days: days.length ? days : [key] });
                      }} style={{ ...optionTag(selected) }}>{day.slice(0, 3)}</div>
                    );
                  })}
                </div>
                <Label>Time</Label>
                <input type="time" style={{ ...inputStyle, width: 'auto' }}
                  value={form.scheduleConfig.time || '09:00'}
                  onChange={e => set('scheduleConfig', { ...form.scheduleConfig, time: e.target.value })} />
              </>
            )}
            {form.frequency === 'monthly' && (
              <>
                <Label>Day of month (1–28)</Label>
                <input type="number" min={1} max={28} style={{ ...inputStyle, width: 80 }}
                  value={form.scheduleConfig.date || 1}
                  onChange={e => set('scheduleConfig', { ...form.scheduleConfig, date: Number(e.target.value) })} />
                <Label>Time</Label>
                <input type="time" style={{ ...inputStyle, width: 'auto' }}
                  value={form.scheduleConfig.time || '10:00'}
                  onChange={e => set('scheduleConfig', { ...form.scheduleConfig, time: e.target.value })} />
              </>
            )}
          </div>
        )}

        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Label>Where should posts be published?</Label>
            <Toggle label="📷 Instagram" checked={form.postToInstagram} onChange={v => set('postToInstagram', v)} />
            <Toggle label="f  Facebook" checked={form.postToFacebook} onChange={v => set('postToFacebook', v)} />
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <Toggle label="Also post to Story (default on)" checked={form.postToStory} onChange={v => set('postToStory', v)} />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
          <button onClick={back} disabled={step === 1} style={step === 1 ? { ...ghostBtn, opacity: 0.4 } : ghostBtn}>
            <ChevronLeft size={14} /> Back
          </button>
          {step === 5
            ? <button onClick={handleSubmit} style={primaryBtn} disabled={loading}>{loading ? 'Creating...' : 'Create Campaign ✓'}</button>
            : <button onClick={next} style={primaryBtn}>Next <ChevronRight size={14} /></button>
          }
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>{children}</div>;
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)', border: `2px solid ${checked ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}
      onClick={() => onChange(!checked)}>
      <span style={{ color: 'var(--text)', fontSize: 13 }}>{label}</span>
      <div style={{ width: 32, height: 17, borderRadius: 10, background: checked ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2, left: checked ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </div>
    </div>
  );
}

const optionCard = (selected) => ({
  background: 'var(--bg)', border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
});
const optionTag = (selected) => ({
  padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  background: selected ? 'var(--primary)' : 'var(--bg)',
  color: selected ? '#fff' : 'var(--text-muted)',
  border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
});

const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalStyle = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 480, maxHeight: '90vh', overflow: 'auto' };
const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none' };
const iconBtn = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 };
const ghostBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 12 };
const ghostSmallBtn = { padding: '4px 8px', borderRadius: 4, background: 'var(--bg-3)', color: 'var(--danger)', border: 'none', cursor: 'pointer', fontSize: 11 };
const primaryBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 6, background: 'var(--primary)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 13 };
const errorStyle = { background: '#2d1212', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 };
