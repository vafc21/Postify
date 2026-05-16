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

  useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'oauth-result' && e.data?.clientId === id) {
        load();
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
    try {
      await api.delete(`/oauth/clients/${id}/tokens/${platform}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || `Failed to disconnect ${platform}`);
    }
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
