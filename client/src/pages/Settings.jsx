import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import api from '../api';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export default function Settings() {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState({
    metaAppId: user?.metaAppId || '',
    metaAppSecret: '',
    storritoApiBase: user?.storritoApiBase || '',
    storritoApiToken: '',
    password: '',
    confirmPassword: '',
    timezone: user?.timezone || 'America/New_York',
    notificationWebhookUrl: user?.notificationWebhookUrl || '',
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (form.password && form.password !== form.confirmPassword) {
      return setError('Passwords do not match');
    }
    setError(''); setLoading(true);
    try {
      const payload = {};
      if (form.metaAppId !== (user?.metaAppId || '')) payload.metaAppId = form.metaAppId;
      if (form.metaAppSecret) payload.metaAppSecret = form.metaAppSecret;
      if (form.storritoApiBase !== (user?.storritoApiBase || '')) payload.storritoApiBase = form.storritoApiBase;
      if (form.storritoApiToken) payload.storritoApiToken = form.storritoApiToken;
      if (form.password) payload.password = form.password;
      if (form.timezone !== (user?.timezone || 'America/New_York')) payload.timezone = form.timezone;
      if (form.notificationWebhookUrl !== (user?.notificationWebhookUrl || '')) {
        payload.notificationWebhookUrl = form.notificationWebhookUrl;
      }

      if (Object.keys(payload).length === 0) {
        setSaved(true); setTimeout(() => setSaved(false), 2000); return;
      }

      const { data } = await api.put('/settings', payload);
      updateUser(data);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      setForm(f => ({ ...f, metaAppSecret: '', storritoApiToken: '', password: '', confirmPassword: '' }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleThemeToggle = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    try {
      await api.put('/settings', { theme: newTheme });
      updateUser({ theme: newTheme });
    } catch (err) {
      setTheme(theme);
      setError('Failed to save theme preference');
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        <Section title="Appearance">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div>
              <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>Dark Mode</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Switch between dark and light interface</div>
            </div>
            <div onClick={handleThemeToggle} style={{ width: 40, height: 22, borderRadius: 11, background: theme === 'dark' ? 'var(--primary)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
              <div style={{ position: 'absolute', top: 3, left: theme === 'dark' ? 20 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </div>
          </div>
        </Section>

        <Section title="Posting Schedule">
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
            Posts publish at their exact scheduled time in your timezone. The times you pick when building a campaign are interpreted in the timezone selected below.
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>Timezone</label>
            <select
              value={form.timezone}
              onChange={set('timezone')}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <Field
            label="Completion Notification Webhook URL"
            value={form.notificationWebhookUrl}
            onChange={set('notificationWebhookUrl')}
            placeholder="https://hooks.slack.com/... (optional)"
          />
          <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>
            After each post publishes, a JSON payload is sent to this URL with the client name and platforms posted to. Works with Slack, Discord, Zapier, etc.
          </div>
        </Section>

        <Section title="Meta API Credentials">
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
            Your Meta Developer App credentials. These are used to connect your clients' Instagram and Facebook accounts via OAuth. <strong style={{ color: 'var(--text)' }}>Required before connecting any client account.</strong>
          </div>
          <Field label="App ID" value={form.metaAppId} onChange={set('metaAppId')} placeholder="Your Meta App ID" />
          <Field label="App Secret" value={form.metaAppSecret} onChange={set('metaAppSecret')} placeholder="Leave blank to keep current secret" type="password" />
          {user?.metaAppId && <div style={{ color: 'var(--success)', fontSize: 11 }}>✓ App ID saved</div>}
        </Section>

        <Section title="Stories API (Storrito)">
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
            Optional. Lets clients marked "uses Stories" publish interactive story stickers (polls, link stickers, hashtags) that Meta's API can't. Create a token in your Storrito account under <strong style={{ color: 'var(--text)' }}>API Credentials</strong> (shown once — it can't be retrieved later); the Base URL is your account-specific host on the same screen. Without this, stories still post — just without native stickers.
          </div>
          <Field label="API Base URL" value={form.storritoApiBase} onChange={set('storritoApiBase')} placeholder="https://your-account-id.storrito.com" />
          <Field label="API Token" value={form.storritoApiToken} onChange={set('storritoApiToken')} placeholder="Leave blank to keep current token" type="password" />
          {user?.storritoConfigured && <div style={{ color: 'var(--success)', fontSize: 11 }}>✓ Storrito connected</div>}
        </Section>

        <Section title="Account">
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Email: <strong style={{ color: 'var(--text)' }}>{user?.email}</strong></div>
          <Field label="New Password" value={form.password} onChange={set('password')} placeholder="Leave blank to keep current" type="password" />
          <Field label="Confirm Password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Confirm new password" type="password" />
        </Section>

        {error && <div style={{ background: '#2d1212', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" style={{ padding: '9px 20px', borderRadius: 6, background: saved ? 'var(--success)' : 'var(--primary)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 13 }} disabled={loading}>
            {loading ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>{label}</label>
      <input style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
        type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}
