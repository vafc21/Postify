# Smooth the Storrito "Connect for Stories" flow

- **Date:** 2026-06-12
- **Status:** Approved (design); pending implementation plan
- **Author:** Vlad + Claude

## Summary

Reduce the friction of linking a client's Instagram account to Storrito (the one-time setup that enables interactive sticker stories). Client-only change to the `StoriesCard` in [ClientProfile.jsx](../../../client/src/pages/ClientProfile.jsx): deep-link to Storrito's connect page, clear numbered steps, auto-verify when the operator returns to the Postify tab, and a manual-handle fallback. No backend change — the sync endpoint already accepts a manual handle.

## Background

- Linking an IG account to Storrito is unavoidably a one-time manual process on Storrito's side; there is no Storrito API to do it (their API only `list`s already-connected accounts). Confirmed against Storrito's help center.
- There IS an **online, no-app** path: Storrito's "Standard Connection" — enter the IG username+password directly at `https://app.storrito.com/#/instagram/connect`. The desktop "Native Connect" app is only needed for accounts with **2FA enabled or Facebook login**.
- Every Storrito method uses raw IG credentials (no official OAuth exists — Instagram has no Stories API). Out of scope to change that.
- Today's flow: the `StoriesCard` (shown when `client.usesStories`) has one "Connect for Stories" button that calls `POST /clients/:id/storrito/sync` with no body. If the client's IG handle can't be resolved (no IG token in Postify) it returns *"Connect this client's Instagram account first, or pass the handle manually."* — a dead end in the current UI because there's no manual-handle input. The sync endpoint already supports `{ instagramUsername }`.

## Decisions (from brainstorming)

1. Smooth the flow as much as Storrito allows; the desktop-app step for 2FA accounts can't be removed.
2. Target the **online** Standard Connection path with a deep-link; mention the desktop-app fallback in copy.
3. Auto-verify trigger: **window-focus re-sync** (fires when the operator returns from the Storrito tab) over a polling timer — less code, no background loop. Keep a manual "Verify now" button as fallback.
4. Surface the **manual-handle** input so the "pass the handle manually" error is actionable.
5. Client-only; no backend change.

## Goals

- A client's Stories connection can be completed without leaving guesswork: one click to Storrito's connect page, clear steps, and automatic verification on return.
- The "pass the handle manually" path is reachable from the UI.
- Existing connected/disconnect behavior is preserved.

## Non-goals (YAGNI)

- No removing Storrito's desktop-app requirement (impossible — Storrito-side).
- No official OAuth / Graph connection (doesn't exist for Stories).
- No backend/API changes.
- No polling-timer auto-verify (focus-based only).

## Design (all in `client/src/pages/ClientProfile.jsx`)

### `syncStorrito` handler
Accept an optional handle and pass it through:
```
const syncStorrito = async (handle) => {
  setStorritoBusy(true); setStorritoMsg('');
  try {
    const { data } = await api.post(`/clients/${id}/storrito/sync`, handle ? { instagramUsername: handle } : {});
    if (data.connected) { setStorritoMsg(''); load(); }
    else setStorritoMsg(data.message || `Connect @${data.instagramUsername} in Storrito, then verify again.`);
  } catch (err) {
    setStorritoMsg(err.response?.data?.error || 'Failed to verify Stories connection');
  } finally { setStorritoBusy(false); }
};
```
`onSync={syncStorrito}` is already passed to `StoriesCard`; the card will call `onSync()` or `onSync(handle)`.

### `StoriesCard` (now a small stateful component)
A module-level constant `STORRITO_CONNECT_URL = 'https://app.storrito.com/#/instagram/connect'`.

Local state: `connecting` (bool), `manualHandle` (string), `showManual` (bool).

When **not connected**, render:
1. **Step 1 — Open Storrito connect:** a button "Open Storrito connect ↗" that `window.open(STORRITO_CONNECT_URL, '_blank', 'noopener')` and sets `connecting = true`.
2. **Steps (numbered, muted text):** (1) Sign in to Storrito. (2) Connect *this* account's Instagram — enter its username + password (accounts with 2FA / Facebook login need Storrito's desktop "Native Connect" app). (3) Come back to this tab — we'll verify automatically.
3. **"Verify now"** button → `onSync()` (manual fallback; also the primary action if they connected earlier).
4. **Manual handle:** a small toggle "IG handle not detected? Enter it" revealing an input + "Verify" button → `onSync(manualHandle.trim())`.
5. The existing `message` (warning) line.

**Auto-verify:** a `useEffect` that, while `connecting && !connected && !busy`, adds a `window` `focus` listener calling `onSync()`; cleaned up on unmount / when connected. A `verifiedRef`/guard prevents duplicate calls per focus. Once `connected` (username set), `connecting` is irrelevant and the card shows the success state (unchanged).

When **connected**, the card is unchanged (✓ Connected · @handle, Remove button).

## Error handling

- Sync failures already surface via `storritoMsg`. The manual-handle path resolves the "pass the handle manually" case.
- `window.open` blocked by a popup blocker: the button is a real user-gesture click so this is unlikely; the "Verify now" + manual flow still work regardless.

## Testing

- No client test runner → verify via `cd client && npm run build` (compile gate) + manual: open a `usesStories` client → StoriesCard shows the steps + deep-link; clicking it opens the Storrito connect page and arms auto-verify; returning to the tab re-runs the sync; the manual-handle input posts the handle; connected state still shows ✓ and Remove.

## Files touched

- **Edit:** `client/src/pages/ClientProfile.jsx` (the `syncStorrito` handler + the `StoriesCard` component + small styles). No other files.
