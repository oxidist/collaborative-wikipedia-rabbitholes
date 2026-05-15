# Table of Contents — Design Spec

**Date:** 2026-05-15  
**Status:** Approved

---

## Overview

Add a collapsible, linked Table of Contents to the article view. The TOC is derived from h2 and h3 headings in the rendered article. On desktop it appears as a sticky left sidebar; on mobile it appears inline at the top of the article, collapsed by default.

---

## Data Model

Add a `TocEntry` type and a `toc` field to `ProcessedArticle`:

```typescript
// packages/types — NOT added here; TOC is web-only, not a WS message

// apps/web/lib/processArticle.ts
export interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

export interface ProcessedArticle {
  html: string
  title: string
  slug: string
  toc: TocEntry[]  // new
}
```

---

## Extraction (`processArticle.ts`)

A new `extractToc(html: string): TocEntry[]` function runs after the sanitize-html pass on the sanitized HTML string. It:

- Regex-scans for `<h2 id="...">` and `<h3 id="...">` elements
- Strips inner HTML tags to get plain text
- Skips headings with no `id` attribute (no anchor target)
- Returns entries in DOM order

`processArticle` calls `extractToc` and includes the result in the returned `ProcessedArticle`. The API route (`/api/wikipedia/[slug]/route.ts`) requires no changes — it already serialises the full `ProcessedArticle` as JSON.

---

## Layout

A new `room-content-layout` CSS grid wrapper is added in `RoomContent` around the `TableOfContents` and `ArticleView`. It is rendered only when an article is loaded.

```tsx
<div className="room-content-layout">
  {article.toc.length > 0 && <TableOfContents toc={article.toc} />}
  <ArticleView ... />
</div>
```

### Desktop (> 600px)
- `grid-template-columns: 200px 1fr`
- Sidebar is sticky at `top: 80px` (44px RoomBar + 36px NavTrail)
- Gap of 24px between sidebar and article

### Mobile (≤ 600px)
- Single column (`grid-template-columns: 1fr`)
- TOC stacks above the article, full width
- TOC starts collapsed; article is full width

The existing `article-container` padding and `ArticleView` internals are unchanged.

---

## `TableOfContents` Component

**File:** `apps/web/components/TableOfContents.tsx`  
**Styles:** `apps/web/components/TableOfContents.module.css`

```typescript
interface TableOfContentsProps {
  toc: TocEntry[]
}
```

- Owns `isOpen` boolean state, default `true`
- Renders a `<nav>` containing a header row and an ordered list
- Header row: "Contents" label + `<button>` toggling `isOpen` with text `[hide]` / `[show]`
- List: h2 entries at the top level; h3 entries indented beneath their preceding h2
- Each entry is `<a href="#id">` — native browser scroll, no JS needed
- When `isOpen` is false, the list is hidden (CSS or conditional render)

**Mobile behaviour:** On mobile the component renders inline (full width, no sticky). The TOC starts collapsed (`isOpen: false`) on mobile — detected via a `useEffect` that checks `window.innerWidth <= 600` on mount and sets `isOpen` accordingly.

---

## CSS Changes (`globals.css`)

```css
/* room-content-layout: sidebar + article grid */
.room-content-layout {
  max-width: 960px;
  margin: 0 auto;
  padding-top: 80px;
  padding-left: 24px;
  padding-right: 24px;
  padding-bottom: 48px;
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 600px) {
  .room-content-layout {
    grid-template-columns: 1fr;
    gap: 0;
  }
}

/* Reset article-container when inside the grid wrapper to avoid double padding */
.room-content-layout .article-container {
  padding: 0;
  max-width: none;
  margin: 0;
}
```

`room-content-layout` owns the outer centering and top padding. The `.article-container` reset prevents the existing 80px top padding and `max-width: 960px` on `article-container` from stacking with the wrapper. `ArticleView` used outside the room layout (e.g. error states) continues to work unchanged since the reset only applies inside `room-content-layout`.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/lib/processArticle.ts` | Add `TocEntry`, `extractToc()`, add `toc` to `ProcessedArticle` and return value |
| `apps/web/app/room/[id]/page.tsx` | Add `room-content-layout` wrapper, render `<TableOfContents toc={article.toc} />` |
| `apps/web/app/globals.css` | Add `.room-content-layout` grid rules |
| `apps/web/components/TableOfContents.tsx` | New component |
| `apps/web/components/TableOfContents.module.css` | New styles |
| `apps/web/__tests__/processArticle.test.ts` | Add TOC extraction tests |
| `apps/web/__tests__/tableOfContents.test.ts` | New component tests |

`packages/types` — no changes.  
`apps/ws` — no changes.  
`apps/web/app/api/wikipedia/[slug]/route.ts` — no changes.

---

## Tests

### `processArticle.test.ts` (additions)
- h2 with id → `toc` entry at level 2
- h3 with id → `toc` entry at level 3
- Heading without id → skipped
- Inner HTML tags stripped from heading text
- Empty article → `toc: []`

### `tableOfContents.test.ts` (new)
- Renders h2 entries as top-level links with correct `href`
- Renders h3 entries indented after their parent h2
- `[hide]` button hides the list; `[show]` button reveals it
- Empty `toc` renders nothing
