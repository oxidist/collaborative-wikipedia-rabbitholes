# Wikihole — Design Spec

_Date: 2026-05-11_

## Overview

A minimal web app that lets any number of people browse Wikipedia together in real time, on a voice call. One shared article state — anyone can click a link and everyone navigates. No accounts, no chat, no game mechanics. Just shared drift through Wikipedia.

---

## Architecture

Two services in a monorepo:

| Service | Stack | Hosting |
|---|---|---|
| `apps/web` | Next.js 14 (App Router) | Vercel |
| `apps/ws` | Node.js + `ws` library | Railway |

**`apps/web`** handles the UI, room creation, and Wikipedia content fetching. All Wikipedia API calls are proxied through a Next.js route handler (`/api/wikipedia/[slug]`) — never from the browser — to avoid CORS issues and keep content processing in one place.

**`apps/ws`** owns all room state. Room state lives behind a `RoomStore` interface (`get`, `set`, `delete`) with an in-memory `Map` as the default implementation. A Redis implementation can be swapped in by changing one import.

Room IDs are 8-character random strings generated with `nanoid`, created client-side when a session is started.

---

## Data Flow

1. User visits `/` — pastes a Wikipedia URL, clicks "Start session"
2. Client generates a room ID, redirects to `/room/[id]`
3. On page load, client opens a WebSocket connection to the `ws` server with `{ type: "join", roomId, articleSlug }`
4. Server creates the room (if new) with that slug, or responds with the current slug (if room already exists)
5. Client sends `/api/wikipedia/[slug]` fetch → Next.js route handler calls Wikipedia REST API, strips chrome, rewrites internal links, returns sanitized HTML
6. On any participant clicking an internal link: client sends `{ type: "navigate", roomId, slug }` → server updates room state → broadcasts `{ type: "navigate", slug }` to all connections in that room → all clients fetch new article

---

## WebSocket Message Protocol

Shared TypeScript union type used by both `apps/web` and `apps/ws`:

```ts
// Client → Server
type ClientMessage =
  | { type: "join"; roomId: string; articleSlug?: string }
  | { type: "navigate"; roomId: string; slug: string }

// Server → Client
type ServerMessage =
  | { type: "sync"; slug: string }           // sent on join — always, with current slug
  | { type: "navigate"; slug: string }       // broadcasted when any participant navigates
  | { type: "participants"; count: number }  // broadcasted on join/leave
```

---

## Room State

```ts
interface RoomStore {
  get(roomId: string): string | undefined        // returns current article slug
  set(roomId: string, slug: string): void
  delete(roomId: string): void
}
```

Default implementation: in-memory `Map<string, string>`. Redis upgrade: implement this interface with `ioredis`, swap the import in `apps/ws/src/store.ts`.

Rooms are ephemeral — a server restart drops all rooms. This is acceptable; users start a new room.

---

## UI

**`/` (home)**
- Single text input for a Wikipedia URL
- Input validation: must match `en.wikipedia.org/wiki/[slug]` pattern, inline error if not
- "Start session" button → generates room ID, redirects to `/room/[id]`

**`/room/[id]`**
- Article body fills the viewport — Wikipedia content is the entire UI
- Minimal fixed bar (top or bottom): article title, back button (session breadcrumb in local React state, not persisted), subtle "N people here" indicator when >1 person is present
- Internal Wikipedia links intercepted — emit `navigate` WebSocket event instead of default navigation
- External links open in new tab
- Brief CSS transition on navigation (fast fade/flash) to signal the "jump" to all participants
- Article HTML rendered via `dangerouslySetInnerHTML` after server-side sanitization with `sanitize-html`

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Wikipedia API error | Inline message ("Couldn't load this article") + back button |
| WebSocket disconnect | Auto-reconnect with exponential backoff (3 attempts), then "Connection lost" banner with manual retry |
| Reconnect success | Client re-sends `join`, server responds with `sync` to restore current state |
| Invalid Wikipedia URL | Client-side inline validation error before any network call |
| Server restart | Room lost — acceptable, no recovery needed |

---

## Content Processing

The `/api/wikipedia/[slug]` route handler:
1. Fetches `https://en.wikipedia.org/api/rest_v1/page/html/[slug]`
2. Strips Wikipedia chrome (nav, sidebar, footer, edit links, hatnotes as needed)
3. Rewrites internal links (`/wiki/[slug]`) to be interceptable by the client (e.g., `data-wiki-slug` attribute)
4. Sanitizes output with `sanitize-html` (removes scripts, unsafe attributes)
5. Returns `{ html: string, title: string, slug: string }`

---

## Testing

- Unit tests for `RoomStore` (in-memory implementation) — validates the interface a Redis implementation must satisfy
- Unit tests for the Wikipedia content processor — link rewriting, chrome stripping, sanitization
- TypeScript as the primary correctness gate for the WebSocket protocol (shared types)
- `npm run lint` and `npm run type-check` run after every file edit per project rules

---

## Monorepo Structure

```
wikihole/
├── apps/
│   ├── web/          # Next.js 14 app
│   └── ws/           # WebSocket server
├── packages/
│   └── types/        # Shared TypeScript types (WebSocket messages)
├── docs/
│   └── superpowers/specs/
└── package.json      # Workspace root (npm workspaces)
```

---

## Nice-to-Haves (post-core)

- Breadcrumb trail visible to all participants (session-only, not persisted)
- Random article button on home page
- Prefetch article on link hover
