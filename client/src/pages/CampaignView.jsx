import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
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
