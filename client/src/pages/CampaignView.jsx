import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Pause, Play, Trash2, Pencil, AlertTriangle, Check, X } from 'lucide-react';
import api from '../api';
import MediaSlot from '../components/MediaSlot';

const STATUS_FILTERS = ['All', 'Missing Media', 'Ready', 'Posted'];

export default function CampaignView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [editingEnd, setEditingEnd] = useState(false);
  const [endDraft, setEndDraft] = useState('');
  const [savingEnd, setSavingEnd] = useState(false);

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

  const startEditEnd = () => {
    setEndDraft(campaign.endDate ? campaign.endDate.slice(0, 10) : '');
    setEditingEnd(true);
  };

  const saveEnd = async () => {
    if (!endDraft) return;
    setSavingEnd(true);
    try {
      const { data } = await api.put(`/campaigns/${id}`, { endDate: endDraft });
      setCampaign(data);
      setEditingEnd(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update end date');
    } finally {
      setSavingEnd(false);
    }
  };

  const deleteCampaign = async () => {
    const postedCount = posts.filter(p => p.status === 'posted').length;
    const warning = postedCount > 0
      ? `Delete "${campaign.name}"? This removes the campaign and all ${posts.length} scheduled slots (including ${postedCount} already posted). Posts already published to Instagram/Facebook will stay live there — this only removes the records from Postify. This cannot be undone.`
      : `Delete "${campaign.name}"? This removes the campaign and all ${posts.length} scheduled slots. This cannot be undone.`;
    if (!confirm(warning)) return;
    try {
      await api.delete(`/campaigns/${id}`);
      navigate(campaign.clientId ? `/clients/${campaign.clientId}` : '/');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete campaign');
    }
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
  const daysUntilEnd = campaign.endDate
    ? Math.ceil((new Date(campaign.endDate) - new Date()) / (24 * 60 * 60 * 1000))
    : null;
  const endingSoon = daysUntilEnd !== null && daysUntilEnd >= 0 && daysUntilEnd <= 7;
  const expired = daysUntilEnd !== null && daysUntilEnd < 0;

  return (
    <div style={{ padding: 24 }}>
      {(endingSoon || expired) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: expired ? '#2d1212' : '#332100', border: `1px solid ${expired ? 'var(--danger)' : 'var(--warning)'}`, color: expired ? 'var(--danger)' : 'var(--warning)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span>
            {expired
              ? `This campaign ended ${Math.abs(daysUntilEnd)} day${Math.abs(daysUntilEnd) === 1 ? '' : 's'} ago. Extend the end date or delete it.`
              : `Campaign ends in ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'} (${formatEndDate(campaign.endDate)}). Extend it if you want to keep posting.`}
          </span>
        </div>
      )}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>Campaign</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>{campaign.name}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{scheduleDesc}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Ends</span>
              {editingEnd ? (
                <>
                  <input type="date" style={{ ...inlineEndInput }} value={endDraft} onChange={e => setEndDraft(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
                  <button onClick={saveEnd} style={iconSaveBtn} disabled={savingEnd}><Check size={12} /></button>
                  <button onClick={() => setEditingEnd(false)} style={iconCancelBtn}><X size={12} /></button>
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--text)' }}>{campaign.endDate ? formatEndDate(campaign.endDate) : 'No end date'}</span>
                  <button onClick={startEditEnd} style={inlineEditBtn} title="Edit end date"><Pencil size={11} /></button>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ background: campaign.isActive ? '#0d4429' : 'var(--bg-3)', color: campaign.isActive ? 'var(--success)' : 'var(--text-muted)', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>
              {campaign.isActive ? '● Active' : '○ Paused'}
            </span>
            <button onClick={toggleActive} style={ghostBtn}>
              {campaign.isActive ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
            </button>
            <button onClick={deleteCampaign} style={dangerBtn}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, marginBottom: 16 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '5px 12px', borderRadius: 5, fontSize: 11, fontWeight: f === filter ? 600 : 400, background: f === filter ? 'var(--primary)' : 'var(--bg-3)', color: f === filter ? '#fff' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
            {f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11, alignSelf: 'center' }}>{filteredPosts.length} slot{filteredPosts.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredPosts.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No slots match this filter.</div>}
        {filteredPosts.map(post => (
          <MediaSlot key={post.id} post={post} onChange={updatePost} />
        ))}
      </div>
    </div>
  );
}

function formatEndDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
const dangerBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', cursor: 'pointer', fontSize: 12 };
const inlineEditBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' };
const inlineEndInput = { padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none' };
const iconSaveBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 5, background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer' };
const iconCancelBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 5, background: 'var(--bg-3)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' };
