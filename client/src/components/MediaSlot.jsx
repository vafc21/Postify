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
    try {
      const { data } = await api.delete(`/posts/${post.id}/media`);
      onChange(data);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove media');
    }
  };

  const saveCaption = async () => {
    try {
      const { data } = await api.put(`/posts/${post.id}`, { caption });
      onChange(data);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save caption');
    }
  };

  const toggleStory = async () => {
    try {
      const { data } = await api.put(`/posts/${post.id}`, { postToStory: !post.postToStory });
      onChange(data);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update story setting');
    }
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

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{scheduledLabel}</div>
            <StatusBadge status={post.status} />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={toggleStory}>
              <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Story</span>
              <div style={{ width: 26, height: 14, borderRadius: 8, background: post.postToStory ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: post.postToStory ? 13 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
            </div>
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

        <textarea
          style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px dashed var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 11, resize: 'vertical', minHeight: 42, outline: 'none', fontFamily: 'inherit' }}
          placeholder="Caption..."
          value={caption}
          onChange={e => setCaption(e.target.value)}
          onBlur={saveCaption}
          disabled={post.status === 'posting'}
        />
      </div>

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
