# Postify Phase 3: Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full React frontend — sidebar layout, dashboard, client profile, campaign view with media upload, campaign wizard, and settings with theme toggle.

**Architecture:** React 19 + React Router v7 + Tailwind CSS v4. Sidebar layout persists across all authenticated routes. Theme (dark/light) applied via a class on `<html>`. Axios instance handles cookie auth automatically.

**Tech Stack:** React 19, React Router v7, Tailwind CSS v4, Axios, Lucide React, React Dropzone

**Prerequisite:** Phases 1 and 2 complete. Server running on port 5000.

---

## File Map

**Delete (old components):**
```
client/src/components/ApiKeyInput.jsx
client/src/components/DropZone.jsx
client/src/components/PlatformCard.jsx
client/src/components/PlatformIcons.jsx
client/src/components/PostStatus.jsx
client/src/components/ProgressBar.jsx
client/src/pages/Upload.jsx
```

**Create:**
- `client/src/api.js`
- `client/src/contexts/AuthContext.jsx`
- `client/src/contexts/ThemeContext.jsx`
- `client/src/App.jsx`
- `client/src/index.css`
- `client/src/components/Layout.jsx`
- `client/src/components/Sidebar.jsx`
- `client/src/components/NewClientModal.jsx`
- `client/src/components/CampaignWizard.jsx`
- `client/src/components/MediaSlot.jsx`
- `client/src/pages/Login.jsx`
- `client/src/pages/Register.jsx`
- `client/src/pages/Dashboard.jsx`
- `client/src/pages/ClientProfile.jsx`
- `client/src/pages/CampaignView.jsx`
- `client/src/pages/Settings.jsx`
- `client/src/pages/OAuthResult.jsx`

---

## Task 1: Delete Old Files and Set Up Global Styles

**Files:**
- Delete: old components listed above
- Modify: `client/src/index.css`

- [ ] **Step 1: Delete old files**

```bash
cd client/src
rm -f components/ApiKeyInput.jsx components/DropZone.jsx components/PlatformCard.jsx
rm -f components/PlatformIcons.jsx components/PostStatus.jsx components/ProgressBar.jsx
rm -f pages/Upload.jsx
```

- [ ] **Step 2: Replace `client/src/index.css`**

```css
@import "tailwindcss";

@theme {
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-surface: #161b22;
  --color-surface-2: #0d1117;
  --color-border: #21262d;
  --color-text: #e6edf3;
  --color-text-muted: #8b949e;
  --color-success: #3fb950;
  --color-danger: #f85149;
  --color-warning: #f9e2af;
}

:root {
  --bg: #0d1117;
  --bg-2: #161b22;
  --bg-3: #21262d;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --success: #3fb950;
  --danger: #f85149;
  --warning: #f9e2af;
}

html.light {
  --bg: #f8fafc;
  --bg-2: #ffffff;
  --bg-3: #e2e8f0;
  --border: #cbd5e1;
  --text: #0f172a;
  --text-muted: #64748b;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --success: #16a34a;
  --danger: #dc2626;
  --warning: #ca8a04;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* Utility classes using CSS variables */
.bg-surface   { background: var(--bg-2); }
.bg-surface-2 { background: var(--bg); }
.bg-card      { background: var(--bg-3); }
.border-base  { border-color: var(--border); }
.text-base    { color: var(--text); }
.text-muted   { color: var(--text-muted); }

/* Scrollbars */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
```

- [ ] **Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat: rebuild global styles with dark/light CSS variable theme"
```

---

## Task 2: API Client and Auth/Theme Contexts

**Files:**
- Create: `client/src/api.js`
- Create: `client/src/contexts/AuthContext.jsx`
- Create: `client/src/contexts/ThemeContext.jsx`

- [ ] **Step 1: Create `client/src/api.js`**

```js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
});

export default api;
```

- [ ] **Step 2: Create `client/src/contexts/AuthContext.jsx`**

```jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settings')
      .then(r => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data.user);
    return data;
  };

  const register = async (email, password) => {
    const { data } = await api.post('/auth/register', { email, password });
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  const updateUser = (updates) => setUser(u => ({ ...u, ...updates }));

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 3: Create `client/src/contexts/ThemeContext.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children, initialTheme = 'dark' }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

- [ ] **Step 4: Commit**

```bash
git add client/src/api.js client/src/contexts/
git commit -m "feat: add API client, auth context, and theme context"
```

---

## Task 3: App Router and Layout Shell

**Files:**
- Modify: `client/src/App.jsx`
- Create: `client/src/components/Layout.jsx`
- Create: `client/src/components/Sidebar.jsx`
- Create: `client/src/pages/OAuthResult.jsx`
- Modify: `client/src/main.jsx`

- [ ] **Step 1: Replace `client/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 2: Replace `client/src/App.jsx`**

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ClientProfile from './pages/ClientProfile';
import CampaignView from './pages/CampaignView';
import Settings from './pages/Settings';
import OAuthResult from './pages/OAuthResult';

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>Loading...</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <ThemeProvider initialTheme={user.theme || 'dark'}>
      <Routes>
        <Route path="/oauth-result" element={<OAuthResult />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients/:id" element={<ClientProfile />} />
          <Route path="/campaigns/:id" element={<CampaignView />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Create `client/src/components/Layout.jsx`**

```jsx
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-2)' }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create `client/src/components/Sidebar.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Settings, Plus, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import NewClientModal from './NewClientModal';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [showNewClient, setShowNewClient] = useState(false);

  useEffect(() => {
    api.get('/clients').then(r => setClients(r.data)).catch(() => {});
  }, []);

  const handleClientCreated = (client) => {
    setClients(prev => [client, ...prev]);
    setShowNewClient(false);
    navigate(`/clients/${client.id}`);
  };

  return (
    <>
      <aside style={{
        width: 220, minWidth: 220, background: 'var(--bg-2)',
        borderRight: '1px solid var(--border)', display: 'flex',
        flexDirection: 'column', height: '100vh',
      }}>
        {/* Logo */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>POSTIFY</span>
        </div>

        {/* Home */}
        <div style={{ padding: '8px' }}>
          <NavLink to="/" end style={({ isActive }) => navStyle(isActive)}>
            <Home size={14} /> Home
          </NavLink>
        </div>

        {/* Clients */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: '8px 10px 4px' }}>CLIENTS</div>
          {clients.map(c => (
            <NavLink key={c.id} to={`/clients/${c.id}`} style={({ isActive }) => navStyle(isActive)}>
              <span style={{ fontSize: 12 }}>📱</span> {c.name}
            </NavLink>
          ))}
          <button onClick={() => setShowNewClient(true)} style={addClientBtnStyle}>
            <Plus size={12} /> Add Client
          </button>
        </div>

        {/* Bottom */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px' }}>
          <NavLink to="/settings" style={({ isActive }) => navStyle(isActive)}>
            <Settings size={14} /> Settings
          </NavLink>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }}
            onClick={logout}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}><LogOut size={10} /> Sign out</div>
            </div>
          </div>
        </div>
      </aside>

      {showNewClient && (
        <NewClientModal onClose={() => setShowNewClient(false)} onCreated={handleClientCreated} />
      )}
    </>
  );
}

const navStyle = (isActive) => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '7px 10px', borderRadius: 6, marginBottom: 2,
  color: isActive ? '#fff' : 'var(--text-muted)',
  background: isActive ? 'var(--primary)' : 'transparent',
  fontWeight: isActive ? 600 : 400,
  textDecoration: 'none', fontSize: 13,
  transition: 'background 0.1s',
});

const addClientBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
  padding: '7px 10px', borderRadius: 6, marginTop: 4,
  color: 'var(--text-muted)', background: 'transparent',
  border: '1px dashed var(--border)', cursor: 'pointer', fontSize: 12,
};
```

- [ ] **Step 5: Create `client/src/pages/OAuthResult.jsx`**

```jsx
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function OAuthResult() {
  const [params] = useSearchParams();
  const success = params.get('success');
  const error = params.get('error');
  const clientId = params.get('clientId');

  useEffect(() => {
    // If opened in a popup, communicate result to the opener and close
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth-result', success, error, clientId }, '*');
      window.close();
    }
  }, [success, error, clientId]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
      {success ? (
        <>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ color: 'var(--success)', fontWeight: 600 }}>Connected successfully!</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>You can close this window.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 40 }}>❌</div>
          <div style={{ color: 'var(--danger)', fontWeight: 600 }}>Connection failed</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error || 'Unknown error'}</div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Start dev server and verify routing works**

```bash
cd client && npm run dev
```
Open http://localhost:5173 — should redirect to `/login`.

- [ ] **Step 7: Commit**

```bash
git add client/src/
git commit -m "feat: add app router, layout, sidebar, OAuth result page"
```

---

## Task 4: Auth Pages (Login + Register)

**Files:**
- Modify: `client/src/pages/Login.jsx`
- Modify: `client/src/pages/Register.jsx`

- [ ] **Step 1: Replace `client/src/pages/Login.jsx`**

```jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
        <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
          No account? <Link to="/register" style={{ color: 'var(--primary)' }}>Register</Link>
        </div>
      </div>
    </div>
  );
}

const pageStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' };
const cardStyle = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 360 };
const inputStyle = { padding: '9px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%' };
const btnStyle = { padding: '10px', borderRadius: 6, background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', width: '100%' };
const errorStyle = { background: '#2d1212', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 8 };
```

- [ ] **Step 2: Replace `client/src/pages/Register.jsx`**

Same structure as Login but calls `register()` and has a confirm password field:

```jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setError(''); setLoading(true);
    try {
      await register(form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { padding: '9px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%' };
  const btnStyle = { padding: '10px', borderRadius: 6, background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', width: '100%' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 360 }}>
        <div style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 22, letterSpacing: 1, marginBottom: 8 }}>POSTIFY</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Create your account</div>
        {error && <div style={{ background: '#2d1212', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input style={inputStyle} type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <input style={inputStyle} type="password" placeholder="Password (min 8 chars)" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          <input style={inputStyle} type="password" placeholder="Confirm password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} required />
          <button type="submit" style={btnStyle} disabled={loading}>{loading ? 'Creating account...' : 'Create Account'}</button>
        </form>
        <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--primary)' }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Test login and register flow in browser**

1. Go to http://localhost:5173/register — create an account
2. Verify redirect to `/` (dashboard, currently empty)
3. Refresh page — should stay logged in (cookie persists)
4. Click sign out — should redirect to `/login`

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Login.jsx client/src/pages/Register.jsx
git commit -m "feat: add login and register pages"
```

---

## Task 5: New Client Modal

**Files:**
- Create: `client/src/components/NewClientModal.jsx`

- [ ] **Step 1: Create `client/src/components/NewClientModal.jsx`**

```jsx
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
```

- [ ] **Step 2: Test in browser**

Click "+ Add Client" in sidebar → modal opens → fill in name → "Create Client" → client appears in sidebar, navigates to client profile (empty for now).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/NewClientModal.jsx
git commit -m "feat: add new client modal"
```

---

## Task 6: Dashboard Page

**Files:**
- Modify: `client/src/pages/Dashboard.jsx`

- [ ] **Step 1: Replace `client/src/pages/Dashboard.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [todos, setTodos] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/posts?status=pending&limit=20'),
      api.get('/posts?upcoming=true&limit=20'),
    ]).then(([todoRes, upcomingRes]) => {
      setTodos(todoRes.data.filter(p => p.status === 'pending'));
      setUpcoming(upcomingRes.data);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={loadingStyle}>Loading...</div>;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>{greeting}, {user?.email?.split('@')[0]} 👋</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {todos.length} pending to-do{todos.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* TO-DOs */}
        <div>
          <div style={sectionLabel}>ALL TO-DOs</div>
          {todos.length === 0 && <EmptyState text="No pending uploads — you're all caught up! 🎉" />}
          {todos.map(post => (
            <PostCard key={post.id} post={post} urgent={isUrgent(post)} onClick={() => navigate(`/campaigns/${post.campaignId}`)} />
          ))}
        </div>

        {/* UPCOMING */}
        <div>
          <div style={sectionLabel}>UPCOMING POSTS — ALL CLIENTS</div>
          {upcoming.length === 0 && <EmptyState text="No upcoming posts scheduled." />}
          {upcoming.map(post => (
            <PostCard key={post.id} post={post} onClick={() => navigate(`/campaigns/${post.campaignId}`)} showStatus />
          ))}
        </div>
      </div>
    </div>
  );
}

function PostCard({ post, urgent, onClick, showStatus }) {
  const borderColor = post.status === 'posted' ? 'var(--success)' : urgent ? 'var(--danger)' : post.status === 'uploaded' ? 'var(--primary)' : 'var(--warning)';
  const dueLabel = new Date(post.scheduledFor).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div onClick={onClick} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, borderLeft: `3px solid ${borderColor}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{post.campaign?.name}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{post.client?.name} · {dueLabel}</div>
        {showStatus && <div style={{ fontSize: 10, marginTop: 3, color: post.status === 'uploaded' ? 'var(--success)' : 'var(--danger)' }}>
          {post.status === 'uploaded' ? '✓ Ready to post' : '⚠ Missing media'}
        </div>}
      </div>
      {!showStatus && (
        <button onClick={e => { e.stopPropagation(); }} style={{ background: 'var(--bg-3)', color: 'var(--primary)', borderRadius: 4, padding: '3px 8px', fontSize: 10, border: 'none', cursor: 'pointer', flexShrink: 0 }}>Upload</button>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0' }}>{text}</div>;
}

function isUrgent(post) {
  return new Date(post.scheduledFor) - new Date() < 24 * 60 * 60 * 1000;
}

const loadingStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' };
const sectionLabel = { color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' };
```

- [ ] **Step 2: Test in browser**

Go to http://localhost:5173/ — should show greeting, empty to-do and upcoming lists.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Dashboard.jsx
git commit -m "feat: add dashboard page with to-dos and upcoming posts"
```

---

## Task 7: Client Profile Page

**Files:**
- Modify: `client/src/pages/ClientProfile.jsx`

- [ ] **Step 1: Replace `client/src/pages/ClientProfile.jsx`**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import api from '../api';
import CampaignWizard from '../components/CampaignWizard';

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/clients/${id}/campaigns`),
    ]).then(([clientRes, campaignRes]) => {
      setClient(clientRes.data);
      setCampaigns(campaignRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Listen for OAuth popup result
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'oauth-result' && e.data?.clientId === id) {
        load(); // Reload to show connected status
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [id, load]);

  const connectPlatform = async (platform) => {
    try {
      const { data } = await api.get(`/oauth/clients/${id}/connect/${platform}`);
      window.open(data.url, 'oauth', 'width=600,height=700,scrollbars=yes');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to initiate connection');
    }
  };

  const disconnectPlatform = async (platform) => {
    if (!confirm(`Disconnect ${platform}?`)) return;
    await api.delete(`/oauth/clients/${id}/tokens/${platform}`);
    load();
  };

  const handleCampaignCreated = (campaign) => {
    setCampaigns(prev => [campaign, ...prev]);
    setShowWizard(false);
    navigate(`/campaigns/${campaign.id}`);
  };

  if (loading) return <div style={loadingStyle}>Loading...</div>;
  if (!client) return <div style={loadingStyle}>Client not found</div>;

  const igToken = client.tokens?.find(t => t.platform === 'instagram');
  const fbToken = client.tokens?.find(t => t.platform === 'facebook');

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16 }}>
            {client.name[0]}
          </div>
          <div>
            <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>{client.name}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{client.businessName || ''}{client.website ? ` · ${client.website}` : ''}</p>
          </div>
        </div>
        <button onClick={() => setShowWizard(true)} style={primaryBtn}>
          <Plus size={14} /> New Campaign
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Connections + Info */}
        <div>
          <SectionLabel>Social Connections</SectionLabel>
          <PlatformCard platform="instagram" token={igToken} onConnect={() => connectPlatform('instagram')} onDisconnect={() => disconnectPlatform('instagram')} />
          <PlatformCard platform="facebook" token={fbToken} onConnect={() => connectPlatform('facebook')} onDisconnect={() => disconnectPlatform('facebook')} />

          {(client.industry || client.contactName || client.contactEmail) && (
            <>
              <SectionLabel style={{ marginTop: 20 }}>Business Info</SectionLabel>
              <div style={infoCard}>
                {client.industry && <InfoRow label="Industry" value={client.industry} />}
                {client.contactName && <InfoRow label="Contact" value={client.contactName} />}
                {client.contactEmail && <InfoRow label="Email" value={client.contactEmail} />}
                {client.notes && <InfoRow label="Notes" value={client.notes} />}
              </div>
            </>
          )}
        </div>

        {/* Campaigns */}
        <div>
          <SectionLabel>Campaigns ({campaigns.length})</SectionLabel>
          {campaigns.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No campaigns yet. Create one to get started.</div>}
          {campaigns.map(c => (
            <div key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                    {c.timesPerCycle}× {c.frequency} · {[c.postToInstagram && 'IG', c.postToFacebook && 'FB'].filter(Boolean).join(' + ')}{c.postToStory ? ' + Story' : ''}
                  </div>
                </div>
                <span style={{ background: c.isActive ? '#0d4429' : 'var(--bg-3)', color: c.isActive ? 'var(--success)' : 'var(--text-muted)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600 }}>
                  {c.isActive ? 'Active' : 'Paused'}
                </span>
              </div>
              {/* Upload progress bar */}
              {c._count && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ background: 'var(--border)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                    <div style={{ background: 'var(--primary)', height: '100%', width: `${Math.min(100, (c.scheduledPosts?.length || 0) / (c._count.scheduledPosts || 1) * 100)}%`, borderRadius: 4 }} />
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 3 }}>{c.scheduledPosts?.length || 0} of {c._count.scheduledPosts} slots have media</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {showWizard && (
        <CampaignWizard clientId={id} onClose={() => setShowWizard(false)} onCreated={handleCampaignCreated} />
      )}
    </div>
  );
}

function PlatformCard({ platform, token, onConnect, onDisconnect }) {
  const isIG = platform === 'instagram';
  const connected = !!token;
  const label = isIG ? 'Instagram' : 'Facebook';
  const icon = isIG ? '📷' : 'f';
  const handle = isIG ? token?.instagramAccountId : token?.pageId;

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 6, background: isIG ? 'linear-gradient(135deg,#f97316,#ec4899)' : '#1877f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>{icon}</div>
        <div>
          <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 11, color: connected ? 'var(--success)' : 'var(--danger)' }}>
            {connected ? `✓ Connected${handle ? ` · ${handle}` : ''}` : '✗ Not connected'}
          </div>
        </div>
      </div>
      {connected
        ? <button onClick={onDisconnect} style={ghostBtn}><RefreshCw size={11} /> Reconnect</button>
        : <button onClick={onConnect} style={primaryBtn}>Connect</button>
      }
    </div>
  );
}

function SectionLabel({ children, style }) {
  return <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, ...style }}>{children}</div>;
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 60 }}>{label}</span>
      <span style={{ color: 'var(--text)', fontSize: 11 }}>{value}</span>
    </div>
  );
}

const infoCard = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 };
const loadingStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' };
const primaryBtn = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, background: 'var(--primary)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 12 };
const ghostBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 11 };
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/ClientProfile.jsx
git commit -m "feat: add client profile page with social connections and campaigns"
```

---

## Task 8: Campaign Wizard Modal

**Files:**
- Create: `client/src/components/CampaignWizard.jsx`

- [ ] **Step 1: Create `client/src/components/CampaignWizard.jsx`**

```jsx
import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api';

const PRESETS = [
  { key: 'brand_awareness', name: 'Brand Awareness', desc: '1× daily' },
  { key: 'daily_tips', name: 'Daily Tips', desc: '1× daily at 9am' },
  { key: 'weekly_highlight', name: 'Weekly Highlight', desc: '1× weekly, Friday' },
  { key: 'product_launch', name: 'Product Launch', desc: '3× daily' },
  { key: 'monthly_recap', name: 'Monthly Recap', desc: '1× monthly, 1st' },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function CampaignWizard({ clientId, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '', description: '',
    type: 'custom', presetTemplate: '',
    frequency: 'daily', timesPerCycle: 1,
    scheduleConfig: { times: ['09:00'] },
    postToInstagram: true, postToFacebook: true, postToStory: true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const next = () => {
    if (step === 1 && !form.name.trim()) return setError('Campaign name is required');
    setError(''); setStep(s => Math.min(s + 1, 5));
  };
  const back = () => { setError(''); setStep(s => Math.max(s - 1, 1)); };

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
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>New Campaign — Step {step} of 5</span>
          <button onClick={onClose} style={iconBtn}><X size={16} /></button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {[1,2,3,4,5].map(s => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: s <= step ? 'var(--primary)' : 'var(--border)' }} />
          ))}
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {/* Step 1: Name */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Label>Campaign Name *</Label>
            <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Summer Promo" autoFocus />
            <Label>Description</Label>
            <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional..." />
          </div>
        )}

        {/* Step 2: Type */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Choose a type</Label>
            <div onClick={() => set('type', 'custom')} style={optionCard(form.type === 'custom')}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>✏️ Custom Campaign</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Build your own schedule from scratch</div>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1, margin: '8px 0 4px', textTransform: 'uppercase' }}>Preset Templates</div>
            {PRESETS.map(p => (
              <div key={p.key} onClick={() => { set('type', 'preset'); set('presetTemplate', p.key); }} style={optionCard(form.type === 'preset' && form.presetTemplate === p.key)}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>📋 {p.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* Step 3: Frequency */}
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

        {/* Step 4: Schedule */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Label>Set your schedule</Label>
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

        {/* Step 5: Platforms */}
        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Label>Where should posts be published?</Label>
            <Toggle label="📷 Instagram" checked={form.postToInstagram} onChange={v => set('postToInstagram', v)} />
            <Toggle label="f  Facebook" checked={form.postToFacebook} onChange={v => set('postToFacebook', v)} />
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <Toggle label="Also post to Story (default on)" checked={form.postToStory} onChange={v => set('postToStory', v)} />
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
          <button onClick={back} disabled={step === 1} style={step === 1 ? { ...ghostBtn, opacity: 0.4 } : ghostBtn}>
            <ChevronLeft size={14} /> Back
          </button>
          {step < 5
            ? <button onClick={next} style={primaryBtn}>Next <ChevronRight size={14} /></button>
            : <button onClick={handleSubmit} style={primaryBtn} disabled={loading}>{loading ? 'Creating...' : 'Create Campaign ✓'}</button>
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
```

- [ ] **Step 2: Test in browser**

On a client profile → click "New Campaign" → complete all 5 steps → campaign appears in client's campaign list, redirects to campaign view.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CampaignWizard.jsx
git commit -m "feat: add 5-step campaign creation wizard"
```

---

## Task 9: Campaign View + MediaSlot Component

**Files:**
- Create: `client/src/components/MediaSlot.jsx`
- Modify: `client/src/pages/CampaignView.jsx`

- [ ] **Step 1: Create `client/src/components/MediaSlot.jsx`**

```jsx
import { useState, useRef } from 'react';
import { Upload, Play, Trash2, RefreshCw, RotateCcw } from 'lucide-react';
import api from '../api';

export default function MediaSlot({ post, onChange }) {
  const [loading, setLoading] = useState(false);
  const [caption, setCaption] = useState(post.caption || '');
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileRef = useRef();
  const SERVER = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

  const borderColor = {
    posted: 'var(--success)',
    posting: 'var(--primary)',
    uploaded: 'var(--primary)',
    failed: 'var(--danger)',
    pending: isUrgent(post) ? 'var(--danger)' : 'var(--warning)',
  }[post.status] || 'var(--border)';

  const uploadFiles = async (files) => {
    if (!files?.length) return;
    setLoading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('media', f));
      const { data } = await api.post(`/posts/${post.id}/media`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(data);
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const deleteMedia = async () => {
    if (!confirm('Remove uploaded media? Slot will revert to pending.')) return;
    const { data } = await api.delete(`/posts/${post.id}/media`);
    onChange(data);
  };

  const saveCaption = async () => {
    const { data } = await api.put(`/posts/${post.id}`, { caption });
    onChange(data);
  };

  const toggleStory = async () => {
    const { data } = await api.put(`/posts/${post.id}`, { postToStory: !post.postToStory });
    onChange(data);
  };

  const unpost = async () => {
    if (!confirm('Attempt to delete this post from Instagram/Facebook?')) return;
    try {
      const { data } = await api.post(`/posts/${post.id}/unpost`);
      onChange(data.post);
      if (data.errors?.length) alert('Partial unpost:\n' + data.errors.join('\n'));
    } catch (err) {
      alert(err.response?.data?.error || 'Unpost failed');
    }
  };

  const hasMedia = post.mediaUrls?.length > 0;
  const scheduledLabel = new Date(post.scheduledFor).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, borderLeft: `3px solid ${borderColor}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {/* Thumbnail / Upload area */}
      <div style={{ flexShrink: 0 }}>
        {hasMedia ? (
          <div style={{ width: 52, height: 52, borderRadius: 6, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
            onClick={() => setPreviewUrl(`${SERVER}${post.mediaUrls[0]}`)}>
            {post.mediaType === 'video'
              ? <><span style={{ fontSize: 20 }}>🎬</span><div style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 4px', color: '#fff', fontSize: 8 }}>▶</div></>
              : <span style={{ fontSize: 20 }}>🖼</span>
            }
            {post.mediaUrls.length > 1 && (
              <div style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 4px', color: '#fff', fontSize: 8 }}>{post.mediaUrls.length}</div>
            )}
          </div>
        ) : (
          <div onClick={() => fileRef.current?.click()}
            style={{ width: 52, height: 52, borderRadius: 6, border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Upload size={18} color="var(--text-muted)" />
          </div>
        )}
        <input ref={fileRef} type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
          onChange={e => uploadFiles(e.target.files)} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{scheduledLabel}</div>
            <StatusBadge status={post.status} />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            {/* Story toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={toggleStory}>
              <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Story</span>
              <div style={{ width: 26, height: 14, borderRadius: 8, background: post.postToStory ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: post.postToStory ? 13 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
            </div>
            {/* Action buttons */}
            {hasMedia && post.status !== 'posted' && (
              <>
                <ActionBtn icon={<Play size={11} />} onClick={() => setPreviewUrl(`${SERVER}${post.mediaUrls[0]}`)} title="Preview" />
                <ActionBtn icon={<RefreshCw size={11} />} onClick={() => fileRef.current?.click()} title="Replace" />
                <ActionBtn icon={<Trash2 size={11} />} onClick={deleteMedia} title="Delete" danger />
              </>
            )}
            {post.status === 'posted' && (
              <>
                <ActionBtn icon={<Play size={11} />} onClick={() => setPreviewUrl(`${SERVER}${post.mediaUrls[0]}`)} title="Preview" />
                <ActionBtn icon={<RotateCcw size={11} />} onClick={unpost} title="Unpost" danger />
              </>
            )}
            {!hasMedia && (
              <button onClick={() => fileRef.current?.click()} style={{ ...actionBtnBase, background: 'var(--primary)', color: '#fff', fontWeight: 600 }}>
                {loading ? '...' : 'Upload'}
              </button>
            )}
          </div>
        </div>

        {/* Media type selector (only when no media) */}
        {!hasMedia && (
          <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
            {['Video', 'Photo', 'Carousel'].map(type => (
              <button key={type} onClick={() => fileRef.current?.click()}
                style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, background: 'var(--bg-3)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                {type === 'Video' ? '🎬' : '🖼'} {type}
              </button>
            ))}
          </div>
        )}

        {/* Caption */}
        <textarea
          style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px dashed var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 11, resize: 'vertical', minHeight: 42, outline: 'none', fontFamily: 'inherit' }}
          placeholder="Caption..."
          value={caption}
          onChange={e => setCaption(e.target.value)}
          onBlur={saveCaption}
          disabled={post.status === 'posting'}
        />
      </div>

      {/* Preview modal */}
      {previewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
          onClick={() => setPreviewUrl(null)}>
          {post.mediaType === 'video'
            ? <video src={previewUrl} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
            : <img src={previewUrl} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain' }} alt="preview" onClick={e => e.stopPropagation()} />
          }
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    posted: ['var(--success)', '✓ Posted'],
    posting: ['var(--primary)', '⟳ Posting...'],
    uploaded: ['var(--primary)', '● Scheduled'],
    failed: ['var(--danger)', '✗ Failed'],
    pending: ['var(--warning)', '○ Pending upload'],
  };
  const [color, label] = map[status] || ['var(--text-muted)', status];
  return <div style={{ color, fontSize: 10, marginTop: 1 }}>{label}</div>;
}

function ActionBtn({ icon, onClick, title, danger }) {
  return (
    <button onClick={onClick} title={title}
      style={{ ...actionBtnBase, color: danger ? 'var(--danger)' : 'var(--text-muted)' }}>
      {icon}
    </button>
  );
}

const actionBtnBase = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 7px', borderRadius: 4, background: 'var(--bg-3)', border: 'none', cursor: 'pointer', fontSize: 11 };

function isUrgent(post) {
  return new Date(post.scheduledFor) - new Date() < 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 2: Replace `client/src/pages/CampaignView.jsx`**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Pause, Play, Edit3 } from 'lucide-react';
import api from '../api';
import MediaSlot from '../components/MediaSlot';

const STATUS_FILTERS = ['All', 'Missing Media', 'Ready', 'Posted'];

export default function CampaignView() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      api.get(`/campaigns/${id}`),
      api.get(`/posts/campaign/${id}`),
    ]).then(([campRes, postsRes]) => {
      setCampaign(campRes.data);
      setPosts(postsRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async () => {
    const { data } = await api.put(`/campaigns/${id}`, { isActive: !campaign.isActive });
    setCampaign(data);
  };

  const updatePost = (updatedPost) => {
    setPosts(prev => prev.map(p => p.id === updatedPost.id ? updatedPost : p));
  };

  const filteredPosts = posts.filter(p => {
    if (filter === 'Missing Media') return p.status === 'pending';
    if (filter === 'Ready') return p.status === 'uploaded';
    if (filter === 'Posted') return p.status === 'posted';
    return true;
  });

  if (loading) return <div style={loadingStyle}>Loading...</div>;
  if (!campaign) return <div style={loadingStyle}>Campaign not found</div>;

  const scheduleDesc = describeSchedule(campaign);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>Campaign</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>{campaign.name}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{scheduleDesc}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ background: campaign.isActive ? '#0d4429' : 'var(--bg-3)', color: campaign.isActive ? 'var(--success)' : 'var(--text-muted)', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>
              {campaign.isActive ? '● Active' : '○ Paused'}
            </span>
            <button onClick={toggleActive} style={ghostBtn}>
              {campaign.isActive ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
            </button>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 16 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '5px 12px', borderRadius: 5, fontSize: 11, fontWeight: f === filter ? 600 : 400, background: f === filter ? 'var(--primary)' : 'var(--bg-3)', color: f === filter ? '#fff' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
            {f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11, alignSelf: 'center' }}>{filteredPosts.length} slot{filteredPosts.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Post slots */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredPosts.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No slots match this filter.</div>}
        {filteredPosts.map(post => (
          <MediaSlot key={post.id} post={post} onChange={updatePost} />
        ))}
      </div>
    </div>
  );
}

function describeSchedule(campaign) {
  const { frequency, timesPerCycle, scheduleConfig, postToInstagram, postToFacebook, postToStory } = campaign;
  const platforms = [postToInstagram && 'IG', postToFacebook && 'FB'].filter(Boolean).join(' + ');
  const story = postToStory ? ' + Story' : '';
  if (frequency === 'daily') return `${timesPerCycle}× daily · ${platforms}${story}`;
  if (frequency === 'weekly') return `Weekly · ${(scheduleConfig.days || []).join(', ')} · ${platforms}${story}`;
  if (frequency === 'monthly') return `Monthly · ${scheduleConfig.date ? `${scheduleConfig.date}th` : ''} · ${platforms}${story}`;
  return '';
}

const loadingStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' };
const ghostBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 12 };
```

- [ ] **Step 3: Test in browser**

1. Create a campaign with 3× daily schedule
2. Navigate to campaign view
3. Verify post slots appear with correct times and pending status
4. Upload a photo to one slot → verify thumbnail appears, status changes to "uploaded"
5. Edit caption → click elsewhere → verify caption saved
6. Toggle story on/off → verify persists on reload
7. Click preview → modal appears with media

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MediaSlot.jsx client/src/pages/CampaignView.jsx
git commit -m "feat: add campaign view with MediaSlot component for upload, preview, caption, story toggle"
```

---

## Task 10: Settings Page

**Files:**
- Modify: `client/src/pages/Settings.jsx`

- [ ] **Step 1: Replace `client/src/pages/Settings.jsx`**

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import api from '../api';

export default function Settings() {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState({
    metaAppId: user?.metaAppId || '',
    metaAppSecret: '',
    password: '',
    confirmPassword: '',
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
      if (form.password) payload.password = form.password;

      if (Object.keys(payload).length === 0) {
        setSaved(true); setTimeout(() => setSaved(false), 2000); return;
      }

      const { data } = await api.put('/settings', payload);
      updateUser(data);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      setForm(f => ({ ...f, metaAppSecret: '', password: '', confirmPassword: '' }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleThemeToggle = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    await api.put('/settings', { theme: newTheme });
    updateUser({ theme: newTheme });
  };

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Theme */}
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

        {/* Meta API */}
        <Section title="Meta API Credentials">
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
            Your Meta Developer App credentials. These are used to connect your clients' Instagram and Facebook accounts via OAuth. <strong style={{ color: 'var(--text)' }}>Required before connecting any client account.</strong>
          </div>
          <Field label="App ID" value={form.metaAppId} onChange={set('metaAppId')} placeholder="Your Meta App ID" />
          <Field label="App Secret" value={form.metaAppSecret} onChange={set('metaAppSecret')} placeholder="Leave blank to keep current secret" type="password" />
          {user?.metaAppId && <div style={{ color: 'var(--success)', fontSize: 11 }}>✓ App ID saved</div>}
        </Section>

        {/* Account */}
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
```

- [ ] **Step 2: Test in browser**

1. Go to Settings → verify theme toggle switches dark/light instantly
2. Reload page → verify theme persists (stored in DB)
3. Enter Meta App ID + Secret → Save → verify "✓ App ID saved" appears
4. Change password → verify works on next login

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Settings.jsx
git commit -m "feat: add settings page with theme toggle and Meta API credentials"
```

---

## Task 11: Self-Review and Spec Coverage Check

- [ ] **Step 1: Run full dev environment**

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

- [ ] **Step 2: Test golden path end-to-end**

1. Register a new user
2. Go to Settings → enter Meta App ID + Secret
3. Create a client
4. Connect Instagram via OAuth (popup) → verify token stored
5. Create a "Daily Tips" campaign (1× daily, 9am)
6. Navigate to campaign view → verify post slots appear
7. Upload a photo to the first slot → verify status changes to "uploaded"
8. Add a caption → tab away → verify saved
9. Toggle story off on one slot → verify persists
10. Check Dashboard → verify to-do appears for pending slots

- [ ] **Step 3: Test theme toggle**

Go to Settings → toggle dark/light → verify all pages switch immediately → reload → verify persists

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Postify frontend — all pages and components"
```

---

## Phase 3 Complete

Phase 3 delivers the complete frontend:
- ✅ Global dark/light theme with CSS variables
- ✅ Auth context + theme context
- ✅ App router with protected routes
- ✅ Sidebar with client list + navigation
- ✅ Login + Register pages
- ✅ Dashboard with all to-dos + upcoming posts
- ✅ Client profile with OAuth connect buttons
- ✅ Campaign wizard (5-step)
- ✅ Campaign view with MediaSlot (video/photo/carousel upload, preview, caption, story toggle, unpost)
- ✅ Settings page (theme toggle, Meta credentials, password)

**Postify redesign complete.** All three phases produce a working, deployable app.
