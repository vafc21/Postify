# Storrito interactive story stickers in the Story Editor

- **Date:** 2026-06-12
- **Status:** Approved (design); pending implementation plan
- **Author:** Vlad + Claude

## Summary

Add Storrito's interactive Instagram-story stickers — **link, hashtag, poll, location** — to the existing Story Editor, each with Storrito's full style/color variants. The stickers are **Instagram + Storrito only**: hidden on the Facebook tab and gated when Storrito isn't connected for the post's client. The existing `mention` sticker also gains a `design` variant for parity.

## Background

- The Story Editor ([client/src/components/StoryEditor.jsx](../../../client/src/components/StoryEditor.jsx)) currently supports three element types: the reshare `post` card, `mention`, and `text`. Instagram (`storyLayout`) and Facebook (`storyLayoutFb`) are edited independently.
- The server renders each layout to a flat 9:16 image/video via [storyRenderer.js](../../../server/services/storyRenderer.js) (handles `post`/`text`/`mention` only; returns null for unknown types).
- Native interactive stickers are published only via **Storrito** ([server/services/storrito.js](../../../server/services/storrito.js)): `buildInstaStoryHtml` emits `<insta-*>` web components over the rendered card. Routing flips IG → Storrito when `client.usesStories && layoutHasNativeStickers(storyLayout)` ([meta.js:173](../../../server/services/meta.js)); `STORRITO_ONLY_TYPES` is currently `{link, hashtag, poll}`. Facebook never uses Storrito.
- The Storrito API + component attributes are confirmed (see [storrito-integration](../../../../.claude/projects/-Users-vlad--Documents-GitHub-Postify/memory/storrito-integration.md)).

## Decisions (resolved in brainstorming)

1. **Scope:** all four sticker types — link, hashtag, poll, location.
2. **Fallback behavior:** Storrito-only. These stickers are Instagram-only and only usable when Storrito is connected; they are **not** flat-rendered on the Graph/Facebook paths. No `storyRenderer.js` changes.
3. **Style variants:** full parity — expose every Storrito design/color option per sticker, with matching editor previews.
4. **Structure:** a self-contained **sticker registry module** (chosen over inline edits or a partial helper).

## Goals

- Author link/hashtag/poll/location stickers in the editor, with style variants, positioned/rotated like existing elements.
- Stickers publish as native, tappable Instagram stickers through Storrito.
- Clear gating so a user can't create a sticker that would silently fail to publish.
- Keep [StoryEditor.jsx](../../../client/src/components/StoryEditor.jsx) focused; isolate each sticker.

## Non-goals (YAGNI)

- No Facebook sticker support.
- No flat-rendering of these stickers on the Graph path.
- No location **search**/autocomplete — free-text name + optional Place ID only (see "The location thing").
- No new scheduling (Postify already owns it).
- The `post`/`text`/`mention` rendering is not rewritten; the registry covers only the new stickers (+ a `design` field on mention).

## Data model

New element types in `storyLayout.elements` (Instagram layout only). Coordinates stay normalized `0..1`; `rotation` in degrees, like existing elements.

| type | fields | variant field (enum) |
|------|--------|----------------------|
| `link` | `url` (string), `text` (string, label) | `design`: `default` \| `gray` \| `black` \| `rainbow` |
| `hashtag` | `tag` (string, no `#`) | `design`: `default` \| `gray` \| `rainbow` |
| `poll` | `question` (string), `options` (string[], 2–4) | `color`: `black` \| `pink` \| `lavender` \| `purple` \| `orange` \| `green` \| `blue` |
| `location` | `location` (string), `locationId` (string, optional) | `design`: `default` \| `gray` \| `black` \| `orange` \| `rainbow` |

The existing `mention` element gains an optional `design`: `default` \| `gray` \| `rainbow`.

Persistence is unchanged: `save()`'s generic `clean()` already serializes any element shape; no save/schema migration needed (layouts are JSON blobs on `Post`).

## Architecture

### New file: `client/src/components/storyStickers.jsx`

A registry keyed by element type. Each entry is self-contained:

```
{
  type: 'hashtag',
  label: 'Hashtag',
  icon: Hash,                 // lucide icon for the palette button
  makeDefault: () => ({...}), // new element (centered-ish, empty/placeholder content, default variant)
  variants: { field: 'design', options: ['default','gray','rainbow'] },
  Preview: ({ el, scale }) => <StickerChip .../>,   // canvas look for the chosen variant
  Controls: ({ el, onChange }) => (...),            // right-rail inputs (content + variant picker)
}
```

Also in this file:
- `StickerChip` — presentational, renders the Instagram-style look; a variant→style map (rainbow gradient, gray translucent, black solid, the 7 poll colors, etc.), scaled by the canvas `scale`.
- `STICKERS` — ordered list/map consumed by StoryEditor.

**The registry is editor-only.** The single source of truth for layout → Storrito HTML stays in the server's `buildInstaStoryHtml`; the client does not duplicate that mapping.

### `client/src/components/StoryEditor.jsx` (edits)

- **Palette:** render an "Add" button per registry entry, in the existing "Add to story" section. Instagram-tab only (like `mention`). Disabled with a notice when `!storritoReady`.
- **Canvas preview:** `EditableElement` keeps its `post`/`text`/`mention` branches; for a registry type it renders `registry[el.type].Preview` inside the existing draggable/rotatable wrapper (drag/rotate/select/remove logic unchanged).
- **Controls:** `ElementControls` dispatches to `registry[el.type].Controls` for registry types; existing branches unchanged. Add a `design` picker to the `mention` controls.
- **New prop `storritoReady: boolean`** (see Gating).

### `client/src/components/MediaSlot.jsx` (edits)

- Accept and forward `storritoReady` to `<StoryEditor>`.

### Provide `storritoReady` upstream

- `storritoReady = (operator has Storrito creds) && (this post's client has storritoUsername)`.
- Thread it from whichever view renders `<MediaSlot>` (post composer). If the client's `storritoUsername` / user's `storritoConfigured` aren't already in that view's data, add them to the relevant fetch. (Exact source confirmed during planning.)

### `server/services/storrito.js` (edits)

- `buildInstaStoryHtml`: emit the variant attribute per component, clamped to the type's enum; omit it when the value equals the type's `default` (keeps the HTML clean) and treat any unrecognized value as `default`:
  - `<insta-link url text design>`
  - `<insta-hashtag hashtag design>`
  - `<insta-poll question options color>`
  - `<insta-location location location-id design>`
  - `<insta-mention username design>`
- Add `'location'` to `STORRITO_ONLY_TYPES` so a location-only story still routes to Storrito.

### `server/services/storyRenderer.js`

- No change expected. Confirm `renderElement` returns null (does not throw) for the new types so the baked card simply omits them.

## Gating behavior

- The four sticker palette buttons appear only on the **Instagram** tab.
- When `storritoReady` is false, the buttons are **disabled** with an inline notice: *"Interactive stickers publish through Storrito — connect it in Settings and link this client to enable."*
- Previews of any already-present stickers still render (nothing silently vanishes in the editor); the existing publish-time `stickerGapReason` continues to flag a story whose stickers can't be delivered.
- `post`/`text`/`mention` are never gated.

## The location thing

- "Location search" is broken upstream because Meta requires *Page Public Content Access* (App Review + Business Verification); today the workaround is pasting a Facebook Place ID ([posts.js:209](../../../server/routes/posts.js)). This is a Meta platform limit (see [meta-api-limitations](../../../../.claude/projects/-Users-vlad--Documents-GitHub-Postify/memory/meta-api-limitations.md)).
- **This feature fixes the *story* side:** the location sticker is free-text (`location="…"`, optional `locationId`), so a user can tag a story location by typing it — no Meta search, no Place ID required.
- **Feed-post location is out of scope:** it still goes through Meta's Graph API and still needs a real Place ID. Storrito does not handle feed posts, so this work does not change it.

## Testing

- **Server (Jest):** `buildInstaStoryHtml` emits the correct `<insta-*>` attributes for each sticker type and each variant (design/color), omits the variant when default, and clamps unknown variants. Assert `location` is in `STORRITO_ONLY_TYPES` (a location-only layout routes to Storrito).
- **Client:** unit-test the registry's `makeDefault` factories and variant option lists. (If no client test harness exists, cover via the app run below.)
- **Manual / app run:** add each sticker → set content + variant → save → confirm the saved `storyLayout` JSON, and that the generated Storrito HTML (via the server unit test or a live `list-instagram-users`-gated dry run) matches. Confirm gating disables the buttons when Storrito isn't connected and that the Facebook tab never shows them.

## Files touched (summary)

- **New:** `client/src/components/storyStickers.jsx`
- **Edit:** `client/src/components/StoryEditor.jsx`, `client/src/components/MediaSlot.jsx`, the post-composer view that supplies `storritoReady`, `server/services/storrito.js`
- **Verify only:** `server/services/storyRenderer.js`
- **Tests:** server Jest for `buildInstaStoryHtml`; client unit test for the registry
