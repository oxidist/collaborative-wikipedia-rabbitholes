# Latency Reduction Design

**Date:** 2026-05-15  
**Scope:** First-article load latency + general navigation latency  
**Branch:** dev

---

## Problem

**First-article (warm server):** 3s on production, 0.5–1s on localhost. Root cause: the article fetch doesn't start until the WebSocket `sync` message arrives — but the article slug is already in the URL at page mount. The WS round-trip (connect → join → sync) is pure overhead before the Wikipedia fetch begins.

**General navigation:** Subsequent article loads feel sluggish. The full round-trip is: WS broadcast → browser → Next.js proxy → Wikipedia API → processArticle → render. No client-side reuse for revisited articles. No head-start on articles the user is likely to click.

---

## Solution Overview

Three targeted changes, no architectural restructuring:

1. **Eager first-article prefetch** — start the fetch on page mount, parallel with WS setup
2. **Client-side article cache** — Map of loaded articles; instant render for revisits
3. **Hover prefetch** — warm the server cache on pointer-enter before the click lands

---

## Section 1: Eager First-Article Prefetch

**File:** `apps/web/app/room/[id]/page.tsx`

Add a `useEffect` with `[initialSlug]` dependency that calls `loadArticle(initialSlug)` on mount if `initialSlug` is set. This fires immediately when the page mounts, in parallel with the WS connection.

Extend the `handleServerMessage` guard to also skip re-fetching an already-loaded slug:

```ts
// Before
if (msg.slug !== loadingSlugRef.current) {
  loadArticle(msg.slug)
}

// After
if (msg.slug !== loadingSlugRef.current && msg.slug !== articleRef.current?.slug) {
  loadArticle(msg.slug)
}
```

The `loadingSlugRef` guard handles the in-flight case (fetch started, not yet complete). The `articleRef.current?.slug` guard handles the already-complete case (fast fetch or cache hit finishes before sync arrives).

**Result:** Room creator's article fetch starts ~200–500ms earlier on localhost, ~500ms–1.5s earlier on production (eliminating the WS round-trip from the critical path).

---

## Section 2: Client-Side Article Cache

**File:** `apps/web/app/room/[id]/page.tsx`

Add `articleMapRef = useRef<Map<string, ArticleData>>(new Map())` to `RoomContent`.

In `loadArticle`:
- Check `articleMapRef.current.get(slug)` before fetching. If found, call `setArticle(cached)` and return immediately — no network, no `isTransitioning` state, no flicker.
- After a successful fetch, store `articleMapRef.current.set(slug, data)`.

The existing `history` array is unchanged — it still drives the back-button ordering. The map adds O(1) slug-keyed lookup for revisits (navigating back multiple hops, or revisiting an article via the trail).

No TTL. Cache is session-scoped; cleared on page refresh. Wikipedia articles don't change mid-session.

**Result:** Revisited articles render instantly with no network request.

---

## Section 3: Hover Prefetch

**Files:** `apps/web/components/ArticleView.tsx`, `apps/web/app/room/[id]/page.tsx`

### In `ArticleView.tsx`

Add two props:
- `isCached: (slug: string) => boolean` — skip prefetch for slugs already in the client cache
- (existing `onWikiLinkClick` and `isTransitioning` unchanged)

Add `prefetchMapRef = useRef<Map<string, AbortController>>(new Map())` inside `ArticleView`.

Use event delegation on the existing container ref (`pointerover`/`pointerout` bubble, unlike `pointerenter`/`pointerleave`):
- `pointerover`: find `closest('[data-wiki-slug]')` on the event target. If slug is not cached and not already prefetching, create an `AbortController`, store it, fire `fetch('/api/wikipedia/${encodeURIComponent(slug)}', { signal })`. On completion (success or abort), remove from map.
- `pointerout`: find `closest('[data-wiki-slug]')` on the event target, abort and remove the matching controller if present.

The fetch is fire-and-forget for its side effect (warming the server's `articleCache` + `coalesce` dedup). The actual `loadArticle` call still happens on click via `onWikiLinkClick`.

### In `page.tsx`

Pass `isCached` to `ArticleView`:
```tsx
isCached={(slug) => articleMapRef.current.has(slug)}
```

**Result:** ~150–400ms head-start on likely-clicked articles. Server's `coalesce` deduplicates if the click arrives while the prefetch is still in flight.

---

## Data Flow (after changes)

```
page mounts
  ├── useEffect: loadArticle(initialSlug)   ← NEW: starts immediately
  └── useRoom: connect() WS

WS sync arrives
  └── handleServerMessage: skip if already loaded/loading   ← NEW guard

user hovers wiki link
  └── pointerenter → prefetch fetch (if not cached)   ← NEW

user clicks wiki link
  ├── navigate(slug) → WS broadcast
  └── loadArticle(slug)
        ├── articleMap hit? → setArticle(cached), done   ← NEW: instant
        └── miss → fetch('/api/wikipedia/slug')
              └── server: coalesce dedup → getCached → Wikipedia API
```

---

## What's Not Changing

- `articleCache.ts` (server-side LRU + coalesce) — untouched
- `processArticle.ts` — untouched
- `useRoom.ts` — untouched
- WS server — untouched
- Back-button behavior (`history` array) — untouched

---

## Testing

- **Eager prefetch:** Verify article renders before or at roughly the same time as WS `sync` in browser devtools Network tab. Confirm no double fetch on the `/api/wikipedia/` endpoint after sync.
- **Client cache:** Navigate A → B → A; confirm the second visit to A shows no network request in devtools.
- **Hover prefetch:** Hover a wiki link, confirm a prefetch request fires in Network tab. Click it, confirm no second Wikipedia API request on the server (or that the response is near-instant from cache).
- Existing test suite must pass unchanged (`npm test`).
