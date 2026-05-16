import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function OAuthResult() {
  const [params] = useSearchParams();
  const success = params.get('success');
  const error = params.get('error');
  const clientId = params.get('clientId');

  useEffect(() => {
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
