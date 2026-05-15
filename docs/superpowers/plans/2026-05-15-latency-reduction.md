# Latency Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce first-article load time by starting the Wikipedia fetch on page mount (parallel with WS setup), add a client-side article cache for instant revisits, and warm the server cache on link hover.

**Architecture:** Three targeted changes to two files. `page.tsx` gets an eager-prefetch effect and a session-scoped `Map` cache so `loadArticle` returns immediately for any slug already fetched. `ArticleView.tsx` gets `pointerover`/`pointerout` delegation that fires a fire-and-forget prefetch fetch, abortable on pointer-leave, to warm the server's existing `articleCache` before the user clicks.

**Tech Stack:** React 18, Next.js 14, Vitest 1.x, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `apps/web/app/room/[id]/page.tsx` | Add `articleMapRef`, update `loadArticle`, add eager-prefetch effect, tighten `handleServerMessage` guard |
| `apps/web/components/ArticleView.tsx` | Add `isCached` prop, add `pointerover`/`pointerout` prefetch delegation |

---

## Task 1: Client-Side Article Cache

**Files:**
- Modify: `apps/web/app/room/[id]/page.tsx`

- [ ] **Step 1: Add `articleMapRef` to `RoomContent`**

In `RoomContent`, after the existing `transitionTimerRef` declaration (line 39), add:

```ts
const articleMapRef = useRef<Map<string, ArticleData>>(new Map())
```

- [ ] **Step 2: Update `loadArticle` to check and populate the cache**

Replace the entire `loadArticle` useCallback with:

```ts
const loadArticle = useCallback(async (slug: string) => {
  if (!slug) return

  const cached = articleMapRef.current.get(slug)
  if (cached) {
    const prev = articleRef.current
    if (prev && prev.slug !== slug) {
      setHistory((h) => [...h, prev])
    }
    articleRef.current = cached
    setArticle(cached)
    return
  }

  loadingSlugRef.current = slug
  setArticleError(false)
  setIsTransitioning(true)
  try {
    const data = await fetchArticle(slug)
    articleMapRef.current.set(slug, data)
    const prev = articleRef.current
    if (prev && prev.slug !== slug) {
      setHistory((h) => [...h, prev])
    }
    articleRef.current = data
    setArticle(data)
  } catch {
    setArticleError(true)
  } finally {
    loadingSlugRef.current = null
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    transitionTimerRef.current = setTimeout(() => setIsTransitioning(false), 200)
  }
}, [])
```

- [ ] **Step 3: Run the test suite**

```bash
cd /path/to/wikihole && npm test
```

Expected: all existing tests pass. No new tests needed — `loadArticle` is a React callback not testable in the current node environment, and the underlying `articleCache.ts` module is already tested.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/room/\[id\]/page.tsx
git commit -m "feat(web): add client-side article cache for instant revisits"
```

---

## Task 2: Eager First-Article Prefetch

**Files:**
- Modify: `apps/web/app/room/[id]/page.tsx`

- [ ] **Step 1: Add eager-prefetch effect**

In `RoomContent`, after the `loadArticle` useCallback and before the `useRoom` call, add:

```ts
// Start fetching the initial article immediately on mount — in parallel with WS connect.
// This removes the WS round-trip from the first-article critical path.
useEffect(() => {
  if (initialSlug) {
    void loadArticle(initialSlug)
  }
}, [initialSlug, loadArticle])
```

- [ ] **Step 2: Tighten the `handleServerMessage` guard**

Find `handleServerMessage` and replace its inner `sync`/`navigate` guard:

```ts
// Before
if (msg.slug !== loadingSlugRef.current) {
  loadArticle(msg.slug)
}

// After — also skip if already loaded
if (msg.slug !== loadingSlugRef.current && msg.slug !== articleRef.current?.slug) {
  loadArticle(msg.slug)
}
```

The full updated function body:

```ts
function handleServerMessage(msg: ServerMessage) {
  if (msg.type === 'sync' || msg.type === 'navigate') {
    if (msg.slug !== loadingSlugRef.current && msg.slug !== articleRef.current?.slug) {
      loadArticle(msg.slug)
    }
  } else if (
    msg.type === 'voice-offer' ||
    msg.type === 'voice-answer' ||
    msg.type === 'voice-ice' ||
    msg.type === 'voice-state'
  ) {
    voiceHandleSignalRef.current(msg)
  }
}
```

- [ ] **Step 3: Run the test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Verify manually in the browser**

Start the dev servers (`npm run dev:web` + `npm run dev:ws`). Open a room URL with `?article=Python_(programming_language)`. In DevTools → Network tab, filter by `wikipedia`. Confirm the `/api/wikipedia/Python_(programming_language)` request fires immediately on page load, **before** the WebSocket `sync` message arrives (visible in the WS frames). Confirm it fires only once (no duplicate request after sync).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/room/\[id\]/page.tsx
git commit -m "feat(web): start article fetch on mount, parallel with WS handshake"
```

---

## Task 3: Hover Prefetch in ArticleView

**Files:**
- Modify: `apps/web/components/ArticleView.tsx`
- Modify: `apps/web/app/room/[id]/page.tsx` (pass new prop)

- [ ] **Step 1: Add `isCached` to `ArticleViewProps` and add internal refs**

Replace the `ArticleViewProps` interface and the top of the `ArticleView` function body:

```ts
interface ArticleViewProps {
  html: string
  onWikiLinkClick: (slug: string) => void
  isTransitioning: boolean
  isCached: (slug: string) => boolean
}

export const ArticleView = memo(function ArticleView({
  html,
  onWikiLinkClick,
  isTransitioning,
  isCached,
}: ArticleViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onClickRef = useRef(onWikiLinkClick)
  onClickRef.current = onWikiLinkClick
  const isCachedRef = useRef(isCached)
  isCachedRef.current = isCached
  const prefetchMapRef = useRef<Map<string, AbortController>>(new Map())
```

- [ ] **Step 2: Add `handlePointerOver` and `handlePointerOut` callbacks**

Add these after the existing `handleClick` useCallback:

```ts
const handlePointerOver = useCallback((e: PointerEvent) => {
  const target = (e.target as HTMLElement).closest('[data-wiki-slug]') as HTMLElement | null
  if (!target) return
  const slug = target.dataset.wikiSlug
  if (!slug) return
  if (isCachedRef.current(slug)) return
  if (prefetchMapRef.current.has(slug)) return
  const controller = new AbortController()
  prefetchMapRef.current.set(slug, controller)
  fetch(`/api/wikipedia/${encodeURIComponent(slug)}`, { signal: controller.signal })
    .catch(() => {})
    .finally(() => { prefetchMapRef.current.delete(slug) })
}, [])

const handlePointerOut = useCallback((e: PointerEvent) => {
  const target = (e.target as HTMLElement).closest('[data-wiki-slug]') as HTMLElement | null
  if (!target) return
  // Don't abort if the pointer moved to a child of the same link element
  if (target.contains(e.relatedTarget as Node | null)) return
  const slug = target.dataset.wikiSlug
  if (!slug) return
  const controller = prefetchMapRef.current.get(slug)
  if (controller) {
    controller.abort()
    prefetchMapRef.current.delete(slug)
  }
}, [])
```

- [ ] **Step 3: Register the pointer listeners and add cleanup**

Replace the existing single `useEffect` for click with two effects:

```ts
useEffect(() => {
  const el = containerRef.current
  if (!el) return
  el.addEventListener('click', handleClick)
  el.addEventListener('pointerover', handlePointerOver)
  el.addEventListener('pointerout', handlePointerOut)
  return () => {
    el.removeEventListener('click', handleClick)
    el.removeEventListener('pointerover', handlePointerOver)
    el.removeEventListener('pointerout', handlePointerOut)
  }
}, [handleClick, handlePointerOver, handlePointerOut])

// Abort all in-flight prefetches on unmount
useEffect(() => {
  return () => {
    prefetchMapRef.current.forEach((c) => c.abort())
    prefetchMapRef.current.clear()
  }
}, [])
```

- [ ] **Step 4: Pass `isCached` from `page.tsx`**

In `apps/web/app/room/[id]/page.tsx`, find both `<ArticleView` usages and add the `isCached` prop to each:

```tsx
// In the TOC layout branch
<ArticleView
  html={article.html}
  onWikiLinkClick={handleWikiLinkClick}
  isTransitioning={isTransitioning}
  isCached={(slug) => articleMapRef.current.has(slug)}
/>

// In the no-TOC branch
<ArticleView
  html={article.html}
  onWikiLinkClick={handleWikiLinkClick}
  isTransitioning={isTransitioning}
  isCached={(slug) => articleMapRef.current.has(slug)}
/>
```

- [ ] **Step 5: Run lint and type-check**

```bash
npm run lint && npm run type-check
```

Expected: no errors. The `isCached` prop is required — TypeScript will catch any missed usage.

- [ ] **Step 6: Run the test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Verify manually in the browser**

Start dev servers. Open a room with an article. In DevTools → Network → filter `wikipedia`. Hover a wiki link without clicking. Confirm a `/api/wikipedia/{slug}` request fires. Move the pointer away — if the request is still in flight (look for "pending"), confirm it is cancelled (status shows as "cancelled" in devtools). Click a different link and confirm the article loads. Navigate back to the first article (via the trail) — confirm no network request fires (served from client cache).

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/ArticleView.tsx apps/web/app/room/\[id\]/page.tsx
git commit -m "feat(web): hover-prefetch wiki links to warm server cache"
```
