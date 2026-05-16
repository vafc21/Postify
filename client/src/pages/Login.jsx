import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 22, letterSpacing: 1, marginBottom: 8 }}>POSTIFY</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Sign in to your account</div>
        {error && <div style={errorStyle}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input style={inputStyle} type="email" placeholder="Email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <input style={inputStyle} type="password" placeholder="Password" value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          <button type="submit" style={btnStyle} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const pageStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' };
const cardStyle = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 360 };
const inputStyle = { padding: '9px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%' };
const btnStyle = { padding: '10px', borderRadius: 6, background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', width: '100%' };
const errorStyle = { background: '#2d1212', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 8 };
