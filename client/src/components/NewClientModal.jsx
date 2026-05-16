import { useState } from 'react';
import { X } from 'lucide-react';
import api from '../api';

export default function NewClientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', businessName: '', website: '', industry: '', contactName: '', contactEmail: '', notes: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Client name is required');
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/clients', form);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create client');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>Add New Client</span>
          <button onClick={onClose} style={iconBtnStyle}><X size={16} /></button>
        </div>
        {error && <div style={errorStyle}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={rowStyle}>
            <Field label="Client Name *" value={form.name} onChange={set('name')} placeholder="e.g. Nike NY" />
            <Field label="Business Name" value={form.businessName} onChange={set('businessName')} placeholder="e.g. Nike NY LLC" />
          </div>
          <div style={rowStyle}>
            <Field label="Website" value={form.website} onChange={set('website')} placeholder="https://" />
            <Field label="Industry" value={form.industry} onChange={set('industry')} placeholder="e.g. Sportswear" />
          </div>
          <div style={rowStyle}>
            <Field label="Contact Name" value={form.contactName} onChange={set('contactName')} placeholder="Jane Smith" />
            <Field label="Contact Email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="jane@client.com" type="email" />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="Optional notes..." />
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            ℹ Instagram and Facebook accounts are connected after the client is created, from their profile page.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" style={submitBtnStyle} disabled={loading}>{loading ? 'Creating...' : 'Create Client →'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div style={{ flex: 1 }}>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalStyle = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 540, maxHeight: '90vh', overflow: 'auto' };
const rowStyle = { display: 'flex', gap: 12 };
const labelStyle = { display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' };
const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none' };
const iconBtnStyle = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 };
const errorStyle = { background: '#2d1212', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 };
const cancelBtnStyle = { padding: '8px 16px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 13 };
const submitBtnStyle = { padding: '8px 16px', borderRadius: 6, background: 'var(--primary)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 13 };
