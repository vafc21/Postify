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
    const loadClients = () => api.get('/clients').then(r => setClients(r.data)).catch(() => {});
    loadClients();
    window.addEventListener('clients-changed', loadClients);
    return () => window.removeEventListener('clients-changed', loadClients);
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
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: 0.5, lineHeight: 1.1, color: 'var(--text)', textTransform: 'uppercase' }}>RJ SEBEK<br />MARKETING</div>
          <div style={{ fontWeight: 700, fontSize: 9, letterSpacing: 1.5, color: '#f5c518', textTransform: 'uppercase', marginTop: 4 }}>CLIENT POSTING HUB</div>
        </div>

        <div style={{ padding: '8px' }}>
          <NavLink to="/" end style={({ isActive }) => navStyle(isActive)}>
            <Home size={14} /> Home
          </NavLink>
        </div>

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
