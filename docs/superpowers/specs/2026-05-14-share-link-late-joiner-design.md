# Share Link + Late Joiner UX — Design

**Date:** 2026-05-14

---

## Share Link

**Component:** `RoomBar.tsx`

Add a "Copy link" button to the right side of the room bar. Clicking it calls `navigator.clipboard.writeText(window.location.href)` and briefly shows "Copied!" for 2 seconds via local `copied` boolean state and a `setTimeout` reset. Styled like the existing back button. No changes outside `RoomBar.tsx` and `globals.css`.

---

## Late Joiner UX

**Component:** `apps/web/app/room/[id]/page.tsx`

**Root cause:** The `article === null` UI state has no distinction between "waiting for the server to sync" and "actively fetching an article." Late joiners sit in the null state until the WS sync arrives and triggers a fetch, showing "Loading…" the whole time. For empty rooms, `sync` is never sent, so `article` stays null indefinitely with no explanation.

**Fix:** Split the null state into two cases:

| `article` | `isTransitioning` | Renders |
|---|---|---|
| null | false | "Waiting for host…" |
| null | true | "Loading…" |
| non-null | either | `<ArticleView>` |

`loadArticle` already sets `isTransitioning = true` immediately on call, so the transition from "Waiting" → "Loading" → article is automatic once the sync arrives. No changes to `useRoom`, the WS server, or the message protocol.

---

## Out of scope

- QR code
- Empty-room "paste a URL" prompt
- Changes to WS server or shared types
