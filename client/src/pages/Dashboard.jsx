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
        <div>
          <div style={sectionLabel}>ALL TO-DOs</div>
          {todos.length === 0 && <EmptyState text="No pending uploads — you're all caught up! 🎉" />}
          {todos.map(post => (
            <PostCard key={post.id} post={post} urgent={isUrgent(post)} onClick={() => navigate(`/campaigns/${post.campaignId}`)} />
          ))}
        </div>

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
