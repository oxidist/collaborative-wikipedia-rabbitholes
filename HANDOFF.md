# Wikihole — Handoff

**Last updated:** 2026-05-15 (session 10)  
**For:** Future Claude Sonnet session

**Active branch:** `dev` — created from `master` and contains all merged feature work. `feature/navigation-trail` → `feature/redis-collapsible-infobox` → `dev` (previous sessions). `voice` branch merged (no-ff) into `dev` this session. `master` has not been updated and is intentionally behind.

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

### Production deployment (Render)

Both services are deployed on Render from the GitHub repo (`oxidist/collaborative-wikipedia-rabbitholes`).

- **WS server** — Render Web Service
  - Build: `npm install && npm run build -w apps/ws`
  - Start: `node apps/ws/dist/index.js`
  - URL: `wss://collaborative-wikipedia-rabbitholes.onrender.com`

- **Web app** — Render Web Service
  - Build: `npm install && npm run build --workspace=apps/web`
  - Start: `npm run start --workspace=apps/web`
  - Env var: `NEXT_PUBLIC_WS_URL=wss://collaborative-wikipedia-rabbitholes.onrender.com`

Note: `output: 'standalone'` was tried and removed — Next.js standalone mode doesn't reliably produce `server.js` in a monorepo context. `next start` is used instead.

---

## What's fully built

### Shared types (`packages/types`)
- `ClientMessage`: `join` (with roomId + optional articleSlug) and `navigate` (roomId + slug)
- `ServerMessage`: `sync` (slug + full `trail: string[]` on join), `navigate` (broadcast), `participants` (count)

### WebSocket server (`apps/ws`)
- `RoomStore` interface is async; `get(roomId)` returns `{ slug, trail } | undefined`. Two backends:
  - `MemoryRoomStore` (in-process Map) — default
  - `RedisRoomStore` — selected when `REDIS_URL` is set; persists rooms as JSON-encoded `{slug, trail}` strings under the `wh:room:` prefix. Backward-compatible with the legacy bare-slug values written before the trail field existed.
- `setSlug(roomId, slug)` is the single atomic operation that mutates a room: it updates the current slug AND updates the trail. Consecutive duplicates are suppressed; if `slug` matches the entry just before the last (a one-step back navigation), the last entry is popped so `A→B→A` collapses to `[A]`. Anything else appends. Creates the room (with `trail: [slug]`) if it doesn't exist.
- Room lifecycle: join adds the WebSocket to the room's Set, leave removes; empty room deletes from store
- On `join`: seeds the room with the joiner's `articleSlug` if it doesn't exist yet, then sends `sync` with `{slug, trail}` to the joiner; broadcasts updated participant count to all
- On `navigate`: `setSlug` (atomic update + append), then broadcasts `navigate` to all members (including sender)
- Binds on `0.0.0.0` (all interfaces) — supports local network and ngrok use
- Port via `PORT` env var, defaults to 8080
- Tests in `src/__tests__/server.test.ts` and `store.test.ts` cover trail seeding, consecutive-dedup, one-step back collapse, non-back revisits being appended, and late-joiner receiving the full trail through `sync`.

### Wikipedia proxy (`apps/web/app/api/wikipedia/[slug]/route.ts`)
- Fetches from `https://en.wikipedia.org/api/rest_v1/page/mobile-html/{slug}` — mobile-optimized endpoint, 3–10x smaller than Parsoid HTML, significantly faster fetch and processing
- Validates slug (length cap, no control characters)
- 5 MB response size guard
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- Returns `ProcessedArticle` — sanitized HTML + extracted title + slug
- If fetch timeouts occur (e.g. over ngrok), add an `AbortController` with a 15s deadline.

### Content processor (`apps/web/lib/processArticle.ts`)
- Sanitizes Wikipedia's mobile HTML via `sanitize-html`
- Rewrites internal wiki links (both `./Slug` Parsoid format and `/wiki/Slug` classic) to `data-wiki-slug` attributes with no `href` — prevents router navigation, keeps keyboard access via `tabindex="0"`
- **Same-page fragment links** (footnotes, section anchors) use the format `./Article#cite_note-X` in the mobile HTML. When the extracted slug matches the current article slug, the link is preserved as a plain `href="#fragment"` so the browser can jump to the target. Cross-page links with fragments have the fragment stripped (only the slug becomes `data-wiki-slug`).
- Skips non-article namespaces (`File:`, `Special:`, `Help:`, etc.) — these links are stripped of href but not made navigable, so clicking image wrappers does nothing
- External links get `target="_blank" rel="noopener noreferrer"`
- Strips edit sections, navboxes, TOC, category links
- **Strips PCS collapsible-table chrome** — Wikipedia's mobile HTML wraps infoboxes and other collapsible tables in `pcs-collapse-table-collapsed-container` (the "Quick facts ... Born, Died ..." preview header) and `pcs-collapse-table-collapsed-bottom` ("Close" footer) elements that PCS JS would toggle. Without that JS those chrome elements leak into the rendered body as stray text. The exclusive filter drops both via a `pcs-collapse-table-collapsed` substring match; the inner table inside `pcs-collapse-table-content` is preserved (the inline `display:none` is stripped because `style` isn't an allowed attribute).
- **References section** — `reflist` and `mw-references-wrap` elements are kept. Footnote `[N]` clicks jump to the matching `<li id="cite_note-...">` entry at the bottom. Back-links (↑ arrows) in the reference list use PCS-generated `href="./Article#pcs-ref-back-link-cite_note-X"` hrefs; `fixPcsBacklinks` rewrites these to the existing `<sup id="cite_ref-*">` IDs using MediaWiki's naming convention (`cite_note-N` → `cite_ref-N` for anonymous refs, `cite_note-NAME-N` → `cite_ref-NAME_N-0` for named refs), so clicking ↑ scrolls back to the correct superscript in the body.
- Forces `loading="lazy"` on all images — prevents image loading from blocking initial render
- Strips `srcset` from images — browser loads only the medium-res `src` thumbnail instead of picking a high-res variant
- **`<img data-src>`** — some images use `data-src` for lazy loading; the `img` transform promotes it to `src`
- **`<span data-src>` → `<img>`** — Wikipedia's mobile HTML represents main article images as `<span data-src="...">` placeholders that their JS would convert at runtime. The `span` transform does this at parse time so images render without JS
- **`<figure typeof="mw:File/Thumb">` → `wh-thumb` class** — the `figure` transform reads the `typeof` attribute (which would otherwise be stripped) and appends `wh-thumb` to the class list. CSS targets `.wh-thumb` for the boxed float style. This is more reliable than a `[typeof="..."]` attribute selector, which CSS Modules mangles due to the `:` and `/` in the value.
- **`hoistThumbnailsBeforeText`** — post-sanitization pass that moves `wh-thumb` figures to before the first `<p>` in each leaf section. Wikipedia's mobile HTML places figures *after* paragraphs; CSS float only applies to content that comes after the float in DOM order, so this reordering is required for images to sit beside text rather than below it. Only leaf sections (no nested `<section>` tags) are processed to preserve subsection structure.
- **`hoistInfobox`** — post-sanitization pass that extracts `<table class="infobox">` from the lede section and places it before all sections, wrapped in `<div class="wh-infobox-cluster">`. This allows the infobox to float alongside the full article rather than only the lede. HTML parsers foster-parent `<hr>` elements out of `<table>` contexts (invalid HTML in Wikipedia source), which can split a single infobox into multiple table fragments with a bare `<hr>` between them; `hoistInfobox` captures any immediately-following `<hr>` + `<table>` pairs as part of the same cluster so they float together as one unit.

### Web app (`apps/web`)
- **Home page** (`app/page.tsx`): Wikipedia URL input → `parseWikiSlug` → generates `nanoid(8)` room ID → pushes to `/room/{id}?article={slug}`
- **Room page** (`app/room/[id]/page.tsx`): wires `useRoom` + `loadArticle` + back history. Optimistic navigation: clicks trigger local load immediately and also broadcast via WS. Placeholder states: "Loading…" (fetch in flight, or `initialSlug` is set and WS handshake is pending), "Waiting for host…" (late joiner, no sync received yet).
- **`useRoom` hook** (`hooks/useRoom.ts`): WebSocket client. WS URL from `NEXT_PUBLIC_WS_URL` env var, defaults to `ws://localhost:8080`. Exponential backoff reconnect (3 retries, max 8s delay). Stable `connect()` via refs — no re-registration on re-render. Returns `trail: string[]` alongside `participantCount`, `navigate`, etc. Trail state is replaced on `sync` and appended (with consecutive-dedup) on `navigate`.
- **`ArticleView`** (`components/ArticleView.tsx`): renders sanitized HTML via `dangerouslySetInnerHTML`, intercepts `[data-wiki-slug]` clicks via event delegation on a stable container ref.
- **`RoomBar`** (`components/RoomBar.tsx`): article title + participant count (only shown when >1) + back button + copy-link button (copies current URL to clipboard, shows "Copied!" for 2s).
- **`NavigationTrail`** (`components/NavigationTrail.tsx`): horizontal strip rendered below `RoomBar` showing every article the room has visited, chevron-separated. The current entry is styled distinctly and non-interactive; past entries are buttons that delegate to `handleWikiLinkClick` (same path wiki-link clicks use — broadcasts `navigate` and optimistically loads). Horizontal scrolls on overflow with the rightmost entry pinned visible (`scrollLeft = scrollWidth` on trail change). An **Export** button is pinned to the right (outside the scroll area) — clicking it copies the trail to clipboard as arrow-separated article titles (`Title A → Title B → Title C`) with 2s "Copied!" feedback. `slugToLabel` (exported) converts `Foo_Bar` → `Foo Bar` for display; `buildExportText` (exported) generates the clipboard text from a slug array.
- **`ConnectionBanner`** (`components/ConnectionBanner.tsx`): shown when WS retries are exhausted, with a retry button.

### Voice chat (`apps/web/lib/voiceChatSession.ts`, `hooks/useVoiceChat.ts`)
- **`VoiceChatSession`** — plain class (no React) managing the full WebRTC lifecycle: `getUserMedia`, `RTCPeerConnection`, ICE candidate queuing, speaking detection via `AudioContext` + `AnalyserNode`, and `leave()` cleanup.
- **Signaling** — offer/answer/ICE candidates are sent as `ClientMessage` via the existing WS connection (`sendSignal`). The WS server relays voice messages (`voice-offer`, `voice-answer`, `voice-ice`, `voice-state`) to all other room members.
- **Glare handling** — `buildPc()` closes and replaces any existing `RTCPeerConnection` when a second negotiation starts (both peers click "Join" simultaneously). `handleAnswer` guards on `signalingState === 'have-local-offer'` to avoid `DOMException` on the orphaned PC.
- **ICE queuing** — candidates that arrive before the remote description is set are queued and drained in `drainCandidates()` after `setRemoteDescription`.
- **Speaking detection** — RAF loop reads `AnalyserNode` RMS each frame; emits only when `speaking`/`remoteSpeaking` values actually change (change-gated to avoid 60fps React re-renders that were breaking article link clicks and causing Safari image flash).
- **Remote audio playback** — remote track is routed `source → remoteAnalyser → audioCtx.destination` so it's both analysed and played back through speakers.
- **`useVoiceChat`** hook — React wrapper; holds `VoiceChatSession` in a ref, exposes `join/leave/toggleMute/handleSignal`. Stores a `pendingOfferRef` for offers that arrive before the user clicks "Join".
- **`RoomBar` voice controls** — Join/Mute/Leave buttons + speaking indicators (pulsing dot for local, ring for remote). Permission-denied error state shown inline.

---

## Key design decisions worth knowing

- **No href on wiki links** — internal wiki links use `data-wiki-slug` + `tabindex="0"` with no `href`. This prevents browser history changes and Next.js router navigation on click; `ArticleView` intercepts via event delegation instead.
- **`connect()` uses refs, not state** — the WS `connect` function has `[]` deps and reads roomId/initialSlug from refs at call time. This prevents double-connection on Strict Mode's simulated unmount/remount and avoids recreating the function when React re-renders.
- **`RoomStore` is async** — even though the current impl is synchronous under the hood, the interface is `Promise`-returning so a Redis backend can be dropped in with no changes to `server.ts`.
- **Participant count broadcast on every join/leave** — simpler than maintaining diffs; count is small data.
- **`isTransitioning || initialSlug` for loading state** — showing "Loading…" requires either an active fetch (`isTransitioning`) or a known initial article (`initialSlug`). Without the `initialSlug` check, the room creator would see "Waiting for host…" during the WS handshake before `sync` arrives.
- **`mobile-html` over `page/html`** — Wikipedia's mobile HTML endpoint is pre-processed and much smaller than Parsoid HTML. Switching reduced first-load time significantly. The trade-off is slightly less semantic richness in the HTML, which hasn't mattered in practice.
- **Wikipedia mobile HTML image format** — images in mobile HTML are not straightforward `<img>` tags. Main article images are `<span data-src="...">` placeholders; some inline images use `<img data-src="...">` with a base64 placeholder as `src`. Both are handled in `processArticle`'s `transformTags`.
- **Wikipedia mobile HTML image placement** — unlike desktop wikitext (which interleaves images with paragraphs), the mobile HTML endpoint places all `<figure>` elements *after* the paragraph text in each section. The `hoistThumbnailsBeforeText` post-processing step corrects this for float layout. If image placement ever looks wrong in a new article, check the DOM order of figures vs paragraphs in the raw mobile HTML.
- **Footnote links are page-relative, not fragment-only** — Wikipedia mobile HTML writes footnote hrefs as `./Article#cite_note-X`, not `#cite_note-X`. The `a` transform detects same-page fragment links (slug matches current article) and preserves the `href="#fragment"` form. Back-links (↑ arrows in the reference list) use PCS-generated hrefs pointing to `pcs-ref-back-link-cite_note-X` IDs; `fixPcsBacklinks` rewrites these to the `<sup id="cite_ref-*">` IDs that Parsoid puts on the superscripts and sanitize-html preserves. Naming convention: `cite_note-N` → `cite_ref-N` (anonymous), `cite_note-NAME-N` → `cite_ref-NAME_N-0` (named, first use).
- **`wh-thumb` class for thumbnail CSS targeting** — `typeof="mw:File/Thumb"` is the reliable marker for thumbnail figures in Wikipedia mobile HTML, but CSS Modules mangles attribute selectors containing `:` and `/`. The `figure` transformTag reads `typeof` before it is stripped and adds `wh-thumb` to the class list. CSS targets `.wh-thumb` instead.
- **Gallery images are a separate structure** — image galleries use `<ul class="gallery mw-gallery-packed"><li class="gallerybox">` rather than `<figure>` elements. They are styled separately via the `ul.gallery` / `li.gallerybox` CSS rules. The inline `style="width: ..."` attributes that Wikipedia sets on gallery items are stripped by sanitize-html, so gallery items use a fixed 200px fallback width.
- **Infobox hoisting and the `wh-infobox-cluster` wrapper** — the infobox `<table class="infobox">` sits inside the lede `<section>` in Wikipedia mobile HTML. A float inside a section can only extend as tall as that section; `hoistInfobox` moves it before all sections so it floats across the full article. The wrapper `<div class="wh-infobox-cluster">` is necessary because HTML parsers foster-parent `<hr>` elements out of table contexts (they're invalid inside `<table>`), splitting one logical infobox into multiple `<table>` fragments with a bare `<hr>` between them. Wrapping the whole cluster in a floated `<div>` keeps the `<hr>` contained inside the float instead of bleeding full-width across the article.
- **Navigation trail is a history log with a one-step back collapse** — navigating to a slug that's the entry just before the last (a back step) pops the last entry, so `A → B → A` becomes `[A]`. Consecutive duplicates are also suppressed (quick double-clicks). Any other revisit is appended faithfully, so `A → B → C → A` stays `[A, B, C, A]` — clicking deeper into the past does NOT truncate the log. Trail entries store slug only; the UI derives display text via `slug.replace(/_/g, ' ')`. The server is canonical; clients are mirrors and apply the same collapse rule on `navigate` to stay in sync without re-broadcasting the full trail.

---

## What's not built yet

### High priority
- **First-article latency** — The initial article load is the slowest part of the experience. Investigate caching at the proxy layer (e.g. persisting processed HTML rather than re-running `processArticle` on every request), CDN edge caching, and whether the Wikipedia API call can be prefetched or warmed server-side at room creation. Perceived latency can also be reduced with a skeleton/shimmer placeholder while the fetch is in flight.
- ~~**Exportable navigation trail**~~ — Done. Export button in `NavigationTrail` copies trail as arrow-separated titles to clipboard.

### Medium priority
- **General navigation latency** — Subsequent article loads also feel sluggish. Profile the full round-trip: WS broadcast → proxy fetch → `processArticle` → React render. Look for the dominant cost (likely the Wikipedia fetch) and consider strategies like link-hover prefetch and client-side article caching (LRU, e.g. 10–20 articles) so back-navigation and revisits are instant.
- **Collapsible, linked table of contents** — A TOC derived from article section headings, with anchor links to jump to each section, collapsible so it doesn't dominate the layout.
- **`.env.example` files** — no documentation of required/optional env vars in each app.
- **Participant cursors / scroll presence** — Show where in the article other participants are reading (a subtle colored indicator per user). Makes the "together" feeling real.

### Low priority
- **Room expiry** — rooms live forever in `MemoryRoomStore` (until restart). A TTL or idle-cleanup pass would be needed for production.
- **Styling** — core layout is in place (floating infobox, floating thumbnails, gallery boxes, section headings, reference list). Further polish remaining.
- **Auth** — anyone who knows the room ID can join. Intentional for now (it's a share-link-based product), but worth noting.
- **Image proxying** — Wikipedia images load directly from Wikimedia CDN. Works fine, but could be blocked in some network environments.
- **Gallery item widths** — gallery items use a fixed 200px width since Wikipedia's inline `style="width: ..."` is stripped by sanitize-html. Could be improved by allowing inline width on `li.gallerybox` elements or inferring width from image dimensions.

---

## Test coverage

- `apps/ws`: server message handling (sync/navigate/late-joiner trail propagation), store CRUD with trail seeding + consecutive-dedup + non-consecutive repeats
- `apps/web`:
  - `parseWikiSlug` (URL parsing edge cases)
  - `processArticle` (link rewriting, sanitization, filtering, lazy image loading, srcset stripping, data-src promotion, span-to-img conversion, same-page fragment links, wh-thumb figure transform, thumbnail hoisting, infobox hoisting and split-table cluster capture, PCS collapsible-table chrome removal)
  - `articleCache` (proxy-side LRU cache + single-flight)
  - `NavigationTrail` (`slugToLabel` slug-to-display helper)
  - `VoiceChatSession` (join/offer/answer/ICE/mute/leave lifecycle, glare guard, speaking-detection change-gating)
- No integration tests, no E2E tests
