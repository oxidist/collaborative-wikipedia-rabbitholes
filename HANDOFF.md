# Wikihole — Handoff

**Last updated:** 2026-05-14 (session 2)  
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

### Local network testing

Both servers bind to `0.0.0.0` so other devices on the LAN can connect. Set `NEXT_PUBLIC_WS_URL=ws://<your-machine-ip>:8080` in `apps/web/.env.local`. Devices connect to `http://<your-machine-ip>:3000` (or 3001).

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
- Binds on `0.0.0.0` (all interfaces) — supports local network and ngrok use
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
- **Same-page fragment links** (footnotes, section anchors) use the format `./Article#cite_note-X` in the mobile HTML. When the extracted slug matches the current article slug, the link is preserved as a plain `href="#fragment"` so the browser can jump to the target. Cross-page links with fragments have the fragment stripped (only the slug becomes `data-wiki-slug`).
- Skips non-article namespaces (`File:`, `Special:`, `Help:`, etc.) — these links are stripped of href but not made navigable, so clicking image wrappers does nothing
- External links get `target="_blank" rel="noopener noreferrer"`
- Strips edit sections, navboxes, TOC, category links
- **References section preserved** — `reflist` and `mw-references-wrap` elements are no longer filtered out. Footnote `[N]` clicks jump to the matching `<li id="cite_note-...">` entry at the bottom.
- Forces `loading="lazy"` on all images — prevents image loading from blocking initial render
- Strips `srcset` from images — browser loads only the medium-res `src` thumbnail instead of picking a high-res variant
- **`<img data-src>`** — some images use `data-src` for lazy loading; the `img` transform promotes it to `src`
- **`<span data-src>` → `<img>`** — Wikipedia's mobile HTML represents main article images as `<span data-src="...">` placeholders that their JS would convert at runtime. The `span` transform does this at parse time so images render without JS
- **`<figure typeof="mw:File/Thumb">` → `wh-thumb` class** — the `figure` transform reads the `typeof` attribute (which would otherwise be stripped) and appends `wh-thumb` to the class list. CSS targets `.wh-thumb` for the boxed float style. This is more reliable than a `[typeof="..."]` attribute selector, which CSS Modules mangles due to the `:` and `/` in the value.
- **`hoistThumbnailsBeforeText`** — post-sanitization pass that moves `wh-thumb` figures to before the first `<p>` in each leaf section. Wikipedia's mobile HTML places figures *after* paragraphs; CSS float only applies to content that comes after the float in DOM order, so this reordering is required for images to sit beside text rather than below it. Only leaf sections (no nested `<section>` tags) are processed to preserve subsection structure.

### Web app (`apps/web`)
- **Home page** (`app/page.tsx`): Wikipedia URL input → `parseWikiSlug` → generates `nanoid(8)` room ID → pushes to `/room/{id}?article={slug}`
- **Room page** (`app/room/[id]/page.tsx`): wires `useRoom` + `loadArticle` + back history. Optimistic navigation: clicks trigger local load immediately and also broadcast via WS. Placeholder states: "Loading…" (fetch in flight, or `initialSlug` is set and WS handshake is pending), "Waiting for host…" (late joiner, no sync received yet).
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
- **`isTransitioning || initialSlug` for loading state** — showing "Loading…" requires either an active fetch (`isTransitioning`) or a known initial article (`initialSlug`). Without the `initialSlug` check, the room creator would see "Waiting for host…" during the WS handshake before `sync` arrives.
- **`mobile-html` over `page/html`** — Wikipedia's mobile HTML endpoint is pre-processed and much smaller than Parsoid HTML. Switching reduced first-load time significantly. The trade-off is slightly less semantic richness in the HTML, which hasn't mattered in practice.
- **Wikipedia mobile HTML image format** — images in mobile HTML are not straightforward `<img>` tags. Main article images are `<span data-src="...">` placeholders; some inline images use `<img data-src="...">` with a base64 placeholder as `src`. Both are handled in `processArticle`'s `transformTags`.
- **Wikipedia mobile HTML image placement** — unlike desktop wikitext (which interleaves images with paragraphs), the mobile HTML endpoint places all `<figure>` elements *after* the paragraph text in each section. The `hoistThumbnailsBeforeText` post-processing step corrects this for float layout. If image placement ever looks wrong in a new article, check the DOM order of figures vs paragraphs in the raw mobile HTML.
- **Footnote links are page-relative, not fragment-only** — Wikipedia mobile HTML writes footnote hrefs as `./Article#cite_note-X`, not `#cite_note-X`. The `a` transform detects same-page fragment links (slug matches current article) and preserves the `href="#fragment"` form. Back-links from the reference list back to footnote superscripts use a PCS-specific ID scheme (`pcs-ref-back-link-*`) that requires Wikipedia's own JS to set up — they are partially functional at best without that JS running.
- **`wh-thumb` class for thumbnail CSS targeting** — `typeof="mw:File/Thumb"` is the reliable marker for thumbnail figures in Wikipedia mobile HTML, but CSS Modules mangles attribute selectors containing `:` and `/`. The `figure` transformTag reads `typeof` before it is stripped and adds `wh-thumb` to the class list. CSS targets `.wh-thumb` instead.
- **Gallery images are a separate structure** — image galleries use `<ul class="gallery mw-gallery-packed"><li class="gallerybox">` rather than `<figure>` elements. They are styled separately via the `ul.gallery` / `li.gallerybox` CSS rules. The inline `style="width: ..."` attributes that Wikipedia sets on gallery items are stripped by sanitize-html, so gallery items use a fixed 200px fallback width.

---

## What's not built yet

### High priority
- **Redis-backed `RoomStore`** — `MemoryRoomStore` loses all room state on server restart. The interface is ready; just needs a Redis implementation and `REDIS_URL` env var wiring.
- **Production deployment** — no Vercel config for `apps/web`, no Railway/Render config for `apps/ws`. The `NEXT_PUBLIC_WS_URL` env var is how the web app finds the WS server; that's the only wiring needed at deploy time.

### Medium priority
- **`.env.example` files** — no documentation of required/optional env vars in each app.

### Low priority
- **Room expiry** — rooms live forever in `MemoryRoomStore` (until restart). A TTL or idle-cleanup pass would be needed for production.
- **Styling** — core layout is in place (floating thumbnails, gallery boxes, section headings, reference list). Further polish remaining.
- **Auth** — anyone who knows the room ID can join. Intentional for now (it's a share-link-based product), but worth noting.
- **Image proxying** — Wikipedia images load directly from Wikimedia CDN. Works fine, but could be blocked in some network environments.
- **Gallery item widths** — gallery items use a fixed 200px width since Wikipedia's inline `style="width: ..."` is stripped by sanitize-html. Could be improved by allowing inline width on `li.gallerybox` elements or inferring width from image dimensions.

---

## Test coverage

- `apps/ws`: server message handling, store CRUD
- `apps/web`: `parseWikiSlug` (URL parsing edge cases), `processArticle` (link rewriting, sanitization, filtering, lazy image loading, srcset stripping, data-src promotion, span-to-img conversion, same-page fragment links, wh-thumb figure transform, thumbnail hoisting)
- No integration tests, no E2E tests
