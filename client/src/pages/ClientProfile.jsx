import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Pencil, Trash2, ExternalLink } from 'lucide-react';
import api from '../api';
import CampaignWizard from '../components/CampaignWizard';
import NewClientModal from '../components/NewClientModal';

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [storritoBusy, setStorritoBusy] = useState(false);
  const [storritoMsg, setStorritoMsg] = useState('');

  // Drop stale results when the client id changes mid-flight (see CampaignView).
  const reqId = useRef(0);
  const load = useCallback(() => {
    const my = ++reqId.current;
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/clients/${id}/campaigns`),
    ]).then(([clientRes, campaignRes]) => {
      if (my !== reqId.current) return;
      setClient(clientRes.data);
      setCampaigns(campaignRes.data);
    }).catch(console.error).finally(() => { if (my === reqId.current) setLoading(false); });
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

  // One-time "Connect for Stories" verification: checks whether this client's IG
  // account is linked inside the operator's Storrito account. On success it's
  // recorded and sticker stories publish automatically from then on. An optional
  // handle is forwarded when the IG handle can't be auto-resolved from Postify.
  const syncStorrito = async (handle) => {
    setStorritoBusy(true); setStorritoMsg('');
    try {
      const { data } = await api.post(`/clients/${id}/storrito/sync`, handle ? { instagramUsername: handle } : {});
      if (data.connected) { setStorritoMsg(''); load(); }
      else setStorritoMsg(data.message || `Connect @${data.instagramUsername} in Storrito, then verify again.`);
    } catch (err) {
      setStorritoMsg(err.response?.data?.error || 'Failed to verify Stories connection');
    } finally {
      setStorritoBusy(false);
    }
  };

  const disconnectStorrito = async () => {
    if (!confirm('Remove the Stories connection? The account stays connected in Storrito; Postify just stops publishing sticker stories to it.')) return;
    try {
      await api.delete(`/clients/${id}/storrito`);
      setStorritoMsg(''); load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove Stories connection');
    }
  };

  const handleCampaignCreated = (campaign) => {
    setCampaigns(prev => [campaign, ...prev]);
    setShowWizard(false);
    navigate(`/campaigns/${campaign.id}`);
  };

  const handleClientUpdated = (updated) => {
    setClient(prev => ({ ...prev, ...updated }));
    setShowEdit(false);
    window.dispatchEvent(new Event('clients-changed'));
  };

  const deleteClient = async () => {
    if (!confirm(`Delete ${client.name}? This permanently removes the client and all their campaigns and scheduled posts. This cannot be undone.`)) return;
    try {
      await api.delete(`/clients/${id}`);
      window.dispatchEvent(new Event('clients-changed'));
      navigate('/');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete client');
    }
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowEdit(true)} style={ghostBtn}><Pencil size={12} /> Edit</button>
          <button onClick={deleteClient} style={dangerBtn}><Trash2 size={12} /> Delete</button>
          <button onClick={() => setShowWizard(true)} style={primaryBtn}>
            <Plus size={14} /> New Campaign
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <SectionLabel>Social Connections</SectionLabel>
          <PlatformCard platform="instagram" token={igToken} onConnect={() => connectPlatform('instagram')} onDisconnect={() => disconnectPlatform('instagram')} />
          <PlatformCard platform="facebook" token={fbToken} onConnect={() => connectPlatform('facebook')} onDisconnect={() => disconnectPlatform('facebook')} />
          {client.usesStories && (
            <StoriesCard
              username={client.storritoUsername}
              busy={storritoBusy}
              message={storritoMsg}
              onSync={syncStorrito}
              onDisconnect={disconnectStorrito}
            />
          )}

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
          {campaigns.map(c => {
            const daysLeft = c.endDate ? Math.ceil((new Date(c.endDate) - new Date()) / 86400000) : null;
            const endingSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
            const expired = daysLeft !== null && daysLeft < 0;
            return (
            <div key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                    {c.timesPerCycle}× {c.frequency} · {[c.postToInstagram && 'IG', c.postToFacebook && 'FB'].filter(Boolean).join(' + ')}{c.postToStory ? ' + Story' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ background: c.isActive ? '#0d4429' : 'var(--bg-3)', color: c.isActive ? 'var(--success)' : 'var(--text-muted)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600 }}>
                    {c.isActive ? 'Active' : 'Paused'}
                  </span>
                  {(endingSoon || expired) && (
                    <span style={{ background: expired ? '#2d1212' : '#332100', color: expired ? 'var(--danger)' : 'var(--warning)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600 }}>
                      {expired ? 'Ended' : `${daysLeft}d left`}
                    </span>
                  )}
                </div>
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
            );
          })}
        </div>
      </div>

      {showWizard && (
        <CampaignWizard clientId={id} onClose={() => setShowWizard(false)} onCreated={handleCampaignCreated} />
      )}
      {showEdit && (
        <NewClientModal client={client} onClose={() => setShowEdit(false)} onCreated={handleClientUpdated} />
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

// Storrito's online "Standard Connection" page — enter the IG username+password
// here (no desktop app, unless the account has 2FA / Facebook login).
const STORRITO_CONNECT_URL = 'https://app.storrito.com/#/instagram/connect';

// The Stories (Storrito) connection — the one-time per-client setup that, once
// done, makes interactive sticker stories publish automatically. Guides the
// operator through Storrito's connect page and auto-verifies on return.
function StoriesCard({ username, busy, message, onSync, onDisconnect }) {
  const connected = !!username;
  const [connecting, setConnecting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualHandle, setManualHandle] = useState('');
  const checkingRef = useRef(false);

  // Once the operator has opened Storrito's connect page, re-run the sync each
  // time they return to this tab — until the account links up.
  useEffect(() => {
    if (!connecting || connected) return undefined;
    const onFocus = () => {
      if (checkingRef.current || busy) return;
      checkingRef.current = true;
      Promise.resolve(onSync()).finally(() => { checkingRef.current = false; });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [connecting, connected, busy, onSync]);

  const openConnect = () => {
    window.open(STORRITO_CONNECT_URL, '_blank', 'noopener');
    setConnecting(true);
  };

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: 'linear-gradient(135deg,#8b5cf6,#ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>✨</div>
          <div>
            <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>Stories (interactive stickers)</div>
            <div style={{ fontSize: 11, color: connected ? 'var(--success)' : 'var(--text-muted)' }}>
              {connected ? `✓ Connected · @${username}` : 'Not connected'}
            </div>
          </div>
        </div>
        {connected
          ? <button onClick={onDisconnect} style={ghostBtn}><RefreshCw size={11} /> Remove</button>
          : <button onClick={openConnect} style={primaryBtn}><ExternalLink size={11} /> Open Storrito connect</button>
        }
      </div>

      {!connected && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <div style={{ marginBottom: 6 }}>One-time setup — links this client's Instagram to Storrito so sticker stories publish automatically:</div>
          <div>1. Sign in to Storrito (opens in a new tab).</div>
          <div>2. Connect <strong style={{ color: 'var(--text)' }}>this account's</strong> Instagram — enter its username + password. Accounts with 2FA or Facebook login need Storrito's desktop "Native Connect" app.</div>
          <div>3. Come back to this tab — we'll verify automatically.</div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onSync()} disabled={busy} style={primaryBtn}>{busy ? 'Verifying…' : 'Verify now'}</button>
            <button onClick={() => setShowManual((s) => !s)} style={ghostBtn}>{showManual ? 'Hide' : 'Enter handle manually'}</button>
          </div>

          {showManual && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                value={manualHandle}
                onChange={(e) => setManualHandle(e.target.value)}
                placeholder="instagram_handle"
                style={{ flex: 1, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)', fontSize: 12 }}
              />
              <button onClick={() => onSync(manualHandle.trim().replace(/^@/, ''))} disabled={busy || !manualHandle.trim()} style={primaryBtn}>Verify</button>
            </div>
          )}
        </div>
      )}

      {!connected && message && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warning)', lineHeight: 1.4 }}>{message}</div>
      )}
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
const dangerBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', cursor: 'pointer', fontSize: 11 };
