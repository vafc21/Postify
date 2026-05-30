import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const ERROR_MESSAGES = {
  oauth_failed: 'Something went wrong during the connection. Please try again.',
  token_exchange_failed: 'Facebook rejected the authorization code. The App Secret in Settings may be wrong, or the redirect URI in your Meta app does not match.',
  long_token_failed: 'Could not extend the access token. Try connecting again.',
  pages_fetch_failed: 'Could not load your Facebook Pages. Make sure you granted the "Show your pages" permission during sign-in.',
  no_pages_found: 'No Facebook Pages were found on this account. You need to be an Admin or Editor of at least one Facebook Page.',
  missing_app_credentials: 'Meta App ID and App Secret have not been set in Settings yet.',
  invalid_state: 'The authorization session expired. Please start over.',
};

export default function OAuthResult() {
  const [params] = useSearchParams();
  const success = params.get('success');
  const error = params.get('error');
  const clientId = params.get('clientId');
  const message = ERROR_MESSAGES[error] || error || 'Unknown error';

  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth-result', success, error, clientId }, window.location.origin);
      if (success) window.close();
    }
  }, [success, error, clientId]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12, padding: 24 }}>
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
          <div style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 400, textAlign: 'center', lineHeight: 1.5 }}>{message}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>Error code: <code>{error}</code></div>
          <button onClick={() => window.close()} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text)', border: 'none', cursor: 'pointer', fontSize: 13 }}>Close</button>
        </>
      )}
    </div>
  );
}
