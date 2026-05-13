# Wikihole — Handoff

**Last updated:** 2026-05-14  
**For:** Future Claude Sonnet session

---

## What this is

Wikihole is a collaborative Wikipedia browser. One person pastes a Wikipedia URL on the home page, a room is created, and everyone in the room navigates articles together in real time. When any participant clicks a wiki link, everyone's view updates.

---

## Monorepo structure

```
apps/
  web/   — Next.js 14 frontend + API proxy
  ws/    — Node.js WebSocket server
packages/
  types/ — Shared TypeScript message types (ClientMessage, ServerMessage)
```

npm workspaces. Run from root:
- `npm run dev:web` — Next.js on port 3000 (falls back to 3001 if taken)
- `npm run dev:ws` — WS server on port 8080 (or `PORT` env var)
- `npm run lint` / `npm run type-check` / `npm run test` — run across all workspaces

---

## What's fully built

### Shared types (`packages/types`)
- `ClientMessage`: `join` (with roomId + optional articleSlug) and `navigate` (roomId + slug)
- `ServerMessage`: `sync` (slug on join), `navigate` (broadcast), `participants` (count)

### WebSocket server (`apps/ws`)
- `RoomStore` interface is async and designed to swap in Redis without touching server logic — currently backed by `MemoryRoomStore` (in-process Map)
- Room lifecycle: join adds to Set, leave removes; empty room deletes from store
- On `join`: sends `sync` to the joiner with current room slug; broadcasts updated participant count to all
- On `navigate`: updates store, broadcasts `navigate` to all members (including sender)
- Binds on `0.0.0.0` (all interfaces) — was changed from default localhost to support local network and ngrok use
- Port via `PORT` env var, defaults to 8080
- Tests in `src/__tests__/server.test.ts` and `store.test.ts`

### Wikipedia proxy (`apps/web/app/api/wikipedia/[slug]/route.ts`)
- Fetches from `https://en.wikipedia.org/api/rest_v1/page/mobile-html/{slug}` — mobile-optimized endpoint, 3–10x smaller than Parsoid HTML, significantly faster fetch and processing
- Validates slug (length cap, no control characters)
- 5 MB response size guard
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- Returns `ProcessedArticle` — sanitized HTML + extracted title + slug
- **Note:** A 15-second fetch timeout was added during a session where articles timed out over ngrok, then reverted by a linter. If timeout issues resurface, re-add `AbortController` with a 15s deadline.

### Content processor (`apps/web/lib/processArticle.ts`)
- Sanitizes Wikipedia's mobile HTML via `sanitize-html`
- Rewrites internal wiki links (both `./Slug` Parsoid format and `/wiki/Slug` classic) to `data-wiki-slug` attributes with no `href` — prevents router navigation, keeps keyboard access via `tabindex="0"`
- External links get `target="_blank" rel="noopener noreferrer"`
- Strips edit sections, navboxes, TOC, reference lists, category links
- Forces `loading="lazy"` on all images — prevents image loading from blocking initial render
- Strips `srcset` from images — browser loads only the medium-res `src` thumbnail instead of picking a high-res variant

### Web app (`apps/web`)
- **Home page** (`app/page.tsx`): Wikipedia URL input → `parseWikiSlug` → generates `nanoid(8)` room ID → pushes to `/room/{id}?article={slug}`
- **Room page** (`app/room/[id]/page.tsx`): wires `useRoom` + `loadArticle` + back history. Optimistic navigation: clicks trigger local load immediately and also broadcast via WS. Three null-article states: "Waiting for host…" (idle, no sync received), "Loading…" (fetch in progress), article view.
- **`useRoom` hook** (`hooks/useRoom.ts`): WebSocket client. WS URL from `NEXT_PUBLIC_WS_URL` env var, defaults to `ws://localhost:8080`. Exponential backoff reconnect (3 retries, max 8s delay). Stable `connect()` via refs — no re-registration on re-render.
- **`ArticleView`** (`components/ArticleView.tsx`): renders sanitized HTML via `dangerouslySetInnerHTML`, intercepts `[data-wiki-slug]` clicks via event delegation on a stable container ref.
- **`RoomBar`** (`components/RoomBar.tsx`): article title + participant count (only shown when >1) + back button + copy-link button (copies current URL to clipboard, shows "Copied!" for 2s).
- **`ConnectionBanner`** (`components/ConnectionBanner.tsx`): shown when WS retries are exhausted, with a retry button.

---

## Key design decisions worth knowing

- **No href on wiki links** — early versions used `href="#"` which caused hash changes and corrupted browser history. The fix was removing `href` entirely and using `data-wiki-slug` + `tabindex` instead.
- **`connect()` uses refs, not state** — the WS `connect` function has `[]` deps and reads roomId/initialSlug from refs at call time. This prevents double-connection on Strict Mode's simulated unmount/remount and avoids recreating the function when React re-renders.
- **`RoomStore` is async** — even though the current impl is synchronous under the hood, the interface is `Promise`-returning so a Redis backend can be dropped in with no changes to `server.ts`.
- **Participant count broadcast on every join/leave** — simpler than maintaining diffs; count is small data.
- **`isTransitioning` distinguishes loading from waiting** — `article === null && isTransitioning === false` means waiting for WS sync; `article === null && isTransitioning === true` means a fetch is in flight. `loadArticle` sets `isTransitioning = true` immediately on call.
- **`mobile-html` over `page/html`** — Wikipedia's mobile HTML endpoint is pre-processed and much smaller than Parsoid HTML. Switching reduced first-load time significantly. The trade-off is slightly less semantic richness in the HTML, which hasn't mattered in practice.

---

## What's not built yet

### High priority
- **Redis-backed `RoomStore`** — `MemoryRoomStore` loses all room state on server restart. The interface is ready; just needs a Redis implementation and `REDIS_URL` env var wiring.
- **Production deployment** — no Vercel config for `apps/web`, no Railway/Render config for `apps/ws`. The `NEXT_PUBLIC_WS_URL` env var is how the web app finds the WS server; that's the only wiring needed at deploy time.

### Medium priority
- **`.env.example` files** — no documentation of required/optional env vars in each app.

### Low priority
- **Room expiry** — rooms live forever in `MemoryRoomStore` (until restart). A TTL or idle-cleanup pass would be needed for production.
- **Styling** — CSS is functional but minimal. No design polish.
- **Auth** — anyone who knows the room ID can join. Intentional for now (it's a share-link-based product), but worth noting.
- **Image proxying** — Wikipedia images load directly from Wikimedia CDN. Works fine, but could be blocked in some network environments.

---

## Test coverage

- `apps/ws`: server message handling, store CRUD
- `apps/web`: `parseWikiSlug` (URL parsing edge cases), `processArticle` (link rewriting, sanitization, filtering, lazy image loading, srcset stripping)
- No integration tests, no E2E tests
