# Storrito Connect-for-Stories UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make linking a client's Instagram to Storrito low-friction — a deep-link to Storrito's online connect page, clear steps, focus-based auto-verify, and a manual-handle fallback.

**Architecture:** Client-only change to `client/src/pages/ClientProfile.jsx`: extend the `syncStorrito` handler to accept an optional handle, and turn the presentational `StoriesCard` into a small stateful component that opens Storrito's connect page, re-runs the sync when the operator returns to the tab (window `focus`), and exposes a manual-handle input. The sync endpoint already accepts `{ instagramUsername }` — no backend change.

**Tech Stack:** React (Vite) client; existing `api` axios wrapper; `lucide-react` icons.

**Spec:** [docs/superpowers/specs/2026-06-12-storrito-connect-ux-design.md](../specs/2026-06-12-storrito-connect-ux-design.md)

---

## File Structure

- **Modify** `client/src/pages/ClientProfile.jsx` — the only file. Two edits: the `syncStorrito` handler (accept a handle) and the `StoriesCard` component (deep-link + steps + auto-verify + manual handle). Reuses the existing `primaryBtn`/`ghostBtn` styles already defined in the file.

**Testing note:** the client has no Jest/Vitest harness; the automated gate is the Vite production build (`cd client && npm run build`), plus the manual checklist in the task. There is no pure logic to unit-test here (it's a React component with browser-event wiring).

---

## Task 1: Smooth the StoriesCard connect flow

**Files:**
- Modify: `client/src/pages/ClientProfile.jsx`

- [ ] **Step 1: Ensure required imports**

At the top of `client/src/pages/ClientProfile.jsx`:
- Ensure the React import includes `useState`, `useEffect`, and `useRef`. If the existing import is e.g. `import { useState } from 'react';`, change it to `import { useState, useEffect, useRef } from 'react';` (add only the missing names).
- Add `ExternalLink` to the existing `lucide-react` import (the file already imports icons like `RefreshCw` from `lucide-react`; add `ExternalLink` to that list).

- [ ] **Step 2: Make `syncStorrito` accept an optional handle**

Replace the existing `syncStorrito` handler (currently posts with no body) with:

```jsx
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
```

The `onSync={syncStorrito}` prop already passed to `StoriesCard` is unchanged; the card will call `onSync()` (no handle) or `onSync(handle)`.

- [ ] **Step 3: Add the connect-URL constant**

Just above the `StoriesCard` function definition, add:

```jsx
// Storrito's online "Standard Connection" page — enter the IG username+password
// here (no desktop app, unless the account has 2FA / Facebook login).
const STORRITO_CONNECT_URL = 'https://app.storrito.com/#/instagram/connect';
```

- [ ] **Step 4: Replace the `StoriesCard` component**

Replace the entire existing `StoriesCard` function with:

```jsx
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
          <div>2. Connect <strong style={{ color: 'var(--text)' }}>this account's</strong> Instagram — enter its username + password. Accounts with 2FA or Facebook login need Storrito's desktop “Native Connect” app.</div>
          <div>3. Come back to this tab — we’ll verify automatically.</div>

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
```

- [ ] **Step 5: Verify it compiles**

Run: `cd client && npm run build`
Expected: build succeeds (no missing-import or JSX errors).

- [ ] **Step 6: Manual verification**

Run the app, open a client that has **uses Stories** checked, and confirm in the Stories card:
- Not connected → the numbered steps + **"Open Storrito connect"** button; clicking it opens `https://app.storrito.com/#/instagram/connect` in a new tab.
- After returning to the Postify tab, the sync re-runs automatically (the card shows "Verifying…" briefly); **"Verify now"** also works on demand.
- **"Enter handle manually"** reveals an input; entering a handle and clicking Verify posts it (clears the "pass the handle manually" dead-end).
- A successful link shows **✓ Connected · @handle** with the **Remove** button (unchanged behavior); Remove still works.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ClientProfile.jsx
git commit -m "feat(clients): guided Storrito connect — deep-link, auto-verify, manual handle"
```

---

## Notes for the implementer

- **No backend change.** `POST /clients/:id/storrito/sync` already accepts `{ instagramUsername }`.
- Reuse the existing `primaryBtn` / `ghostBtn` style consts already defined at the bottom of `ClientProfile.jsx` — do not redefine them.
- The auto-verify only arms after the operator clicks **Open Storrito connect** (`connecting` flag), so the focus listener never runs for someone who isn't mid-connect. `checkingRef` + the `busy` guard prevent overlapping sync calls.
