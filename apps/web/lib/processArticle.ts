import sanitizeHtml from 'sanitize-html'

export interface ProcessedArticle {
  html: string
  title: string
  slug: string
}

export function processArticle(rawHtml: string, slug: string): ProcessedArticle {
  // Extract body content if this is a full HTML document
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyHtml = bodyMatch ? bodyMatch[1] : rawHtml

  // Extract title from first h1 (strip any inner tags)
  const h1Match = bodyHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = h1Match
    ? h1Match[1].replace(/<[^>]+>/g, '').trim()
    : slug.replace(/_/g, ' ')

  // Sanitize and transform in one pass via sanitize-html
  const html = sanitizeHtml(bodyHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',
      'sup', 'sub', 'abbr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'section', 'article', 'aside', 'dl', 'dt', 'dd', 'ruby', 'rt', 'rp',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['class', 'id'],
      a: ['href', 'data-wiki-slug', 'class', 'id', 'rel', 'target', 'tabindex'],
      img: ['src', 'alt', 'width', 'height', 'class', 'loading'],
      td: ['colspan', 'rowspan', 'class'],
      th: ['colspan', 'rowspan', 'scope', 'class'],
      col: ['span', 'class'],
      colgroup: ['span'],
      abbr: ['title'],
    },
    transformTags: {
      a(tagName, attribs) {
        const href = attribs.href ?? ''

        // Internal wiki links: both Parsoid format (./Slug) and classic (/wiki/Slug)
        // Fragment is captured separately — same-page anchors (footnotes, back-refs)
        // are preserved as plain #fragment hrefs rather than wiki navigation.
        const internalMatch = href.match(/^(?:\.\/|\/wiki\/)([^#?]*)(?:#(.+))?/)
        if (internalMatch) {
          let wikiSlug: string
          try {
            wikiSlug = decodeURIComponent(internalMatch[1])
          } catch {
            wikiSlug = internalMatch[1]
          }
          const fragment = internalMatch[2]

          // Skip non-article namespaces (File:, Special:, Help:, etc.)
          if (/^[A-Z][a-zA-Z]+:/.test(wikiSlug)) {
            const { href: _removed, ...rest } = attribs
            return { tagName, attribs: rest }
          }

          // Same-page anchor (footnote [N] → cite_note, back-ref ↑ → cite_ref):
          // keep as a plain fragment href so the browser can jump to the target.
          if (fragment && wikiSlug === slug) {
            return { tagName, attribs: { ...attribs, href: `#${fragment}` } }
          }

          // Cross-page navigation — no href, ArticleView intercepts via data-wiki-slug.
          const { href: _removed, ...rest } = attribs
          return {
            tagName,
            attribs: { ...rest, tabindex: '0', 'data-wiki-slug': wikiSlug },
          }
        }

        // External links: ensure target=_blank and merge rel values safely
        if (/^https?:\/\//i.test(href)) {
          const relParts = (attribs.rel ?? '').split(/\s+/).filter(Boolean)
          if (!relParts.includes('noopener')) relParts.push('noopener')
          if (!relParts.includes('noreferrer')) relParts.push('noreferrer')
          return {
            tagName,
            attribs: { ...attribs, target: '_blank', rel: relParts.join(' ') },
          }
        }

        return { tagName, attribs }
      },
      img(_tagName, attribs) {
        // Wikipedia mobile HTML uses data-src for lazy loading; promote it to src
        const src = attribs['data-src'] ?? attribs.src ?? ''
        return { tagName: 'img', attribs: { ...attribs, src, loading: 'lazy' } }
      },
      // Wikipedia mobile HTML marks thumbnails with typeof="mw:File/Thumb".
      // Normalise this to a stable class so CSS doesn't need an attribute selector
      // with special characters that CSS Modules may mangle.
      figure(_tagName, attribs) {
        const type = attribs.typeof ?? ''
        if (!type.includes('mw:File/Thumb')) return { tagName: 'figure', attribs }
        const base = attribs.class ?? ''
        return {
          tagName: 'figure',
          attribs: { ...attribs, class: base ? `${base} wh-thumb` : 'wh-thumb' },
        }
      },
      // Wikipedia mobile HTML represents main article images as <span data-src="...">
      // instead of <img> — their JS converts these at runtime, we do it at parse time.
      span(_tagName, attribs) {
        if (!attribs['data-src']) return { tagName: 'span', attribs }
        return {
          tagName: 'img',
          attribs: {
            src: attribs['data-src'],
            width: attribs['data-width'] ?? '',
            height: attribs['data-height'] ?? '',
            alt: attribs.alt ?? '',
            class: attribs['data-class'] ?? attribs.class ?? '',
            loading: 'lazy',
          },
        }
      },
    },
    exclusiveFilter: (frame) => {
      // Substring matching is intentional — catches all navbox/editsection variants
      const cls = frame.attribs?.class ?? ''
      const id = frame.attribs?.id ?? ''
      return (
        cls.includes('mw-editsection') ||
        cls.includes('mw-jump-link') ||
        cls.includes('navbox') ||
        cls.includes('printfooter') ||
        cls.includes('catlinks') ||
        id === 'toc'
      )
    },
  })

  return { html: hoistInfobox(hoistThumbnailsBeforeText(fixPcsBacklinks(html))), title, slug }
}

// PCS (Wikipedia's Page Content Service) rewrites reference backlinks so their
// hrefs point to pcs-ref-back-link-cite_note-X IDs that only exist after PCS JS
// runs. Without that JS, clicking ↑ in the reference list goes nowhere.
//
// The static HTML already has <sup id="cite_ref-*"> on every citation superscript
// (from Parsoid, preserved by sanitize-html). We rewrite the backlink hrefs to
// those existing IDs using MediaWiki's stable naming convention:
//   cite_note-N          → cite_ref-N          (anonymous refs)
//   cite_note-NAME-N     → cite_ref-NAME_N-0   (named refs, first use)
function fixPcsBacklinks(html: string): string {
  if (!html.includes('pcs-ref-back-link-')) return html
  return html.replace(
    /href="#pcs-ref-back-link-(cite_note-[^"]+)"/g,
    (match, noteId) => {
      const refId = citeNoteToRefId(noteId)
      return refId ? `href="#${refId}"` : match
    }
  )
}

// Maps a cite_note-* ID to the corresponding first-use cite_ref-* ID.
// Anonymous: cite_note-3      → cite_ref-3
// Named:     cite_note-Foo-2  → cite_ref-Foo_2-0
function citeNoteToRefId(noteId: string): string | null {
  const stripped = noteId.replace(/^cite_note-/, '')
  if (/^\d+$/.test(stripped)) return `cite_ref-${stripped}`
  const m = stripped.match(/^(.+)-(\d+)$/)
  if (m) return `cite_ref-${m[1]}_${m[2]}-0`
  return null
}

// Wikipedia mobile HTML places the infobox <table class="infobox"> inside the lede
// section. Moving it (and any parser-split continuations) to just before the first
// section lets it float across the whole article.
//
// HTML parsers foster-parent <hr> out of <table> contexts, which can split a single
// infobox into: <table class="infobox">…</table><hr><table class="infobox">…</table>.
// We capture the whole cluster and wrap it in a single div so it floats as one unit
// and the <hr> stays contained within the float instead of bleeding full-width.
function hoistInfobox(html: string): string {
  const sectionOpenMatch = /<section\b[^>]*>/.exec(html)
  if (!sectionOpenMatch) return html

  const bodyStart = sectionOpenMatch.index + sectionOpenMatch[0].length
  const sectionEnd = html.indexOf('</section>', bodyStart)
  if (sectionEnd === -1) return html

  const body = html.slice(bodyStart, sectionEnd)

  const infoboxOpenMatch = /<table\b[^>]*\bclass="[^"]*\binfobox\b[^"]*"[^>]*>/i.exec(body)
  if (!infoboxOpenMatch) return html

  // Extract the first table, then greedily grab any <hr> + <table> continuations
  // that immediately follow (artefacts of the HTML parser splitting the infobox).
  let clusterEnd = extractTableEnd(body, infoboxOpenMatch.index)
  if (clusterEnd === -1) return html

  let continuation: RegExpExecArray | null
  while ((continuation = /^(\s*<hr\b[^>]*\/?>\s*)(<table\b)/.exec(body.slice(clusterEnd)))) {
    const nextStart = clusterEnd + continuation[1].length
    const nextEnd = extractTableEnd(body, nextStart)
    if (nextEnd === -1) break
    clusterEnd = nextEnd
  }

  const cluster = body.slice(infoboxOpenMatch.index, clusterEnd)
  const newBody = body.slice(0, infoboxOpenMatch.index) + body.slice(clusterEnd)

  const prefix = html.slice(0, sectionOpenMatch.index)
  const suffix = html.slice(sectionEnd + '</section>'.length)
  return `${prefix}<div class="wh-infobox-cluster">${cluster}</div>${sectionOpenMatch[0]}${newBody}</section>${suffix}`
}

// Walk nested <table> tags from startIndex and return the exclusive end of the
// outermost </table>. Returns -1 if the table is not closed.
function extractTableEnd(body: string, startIndex: number): number {
  const re = /<(\/?)table\b/gi
  re.lastIndex = startIndex
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (m[1] === '/') {
      if (--depth === 0) return m.index + 8 // '</table>' is 8 chars
    } else {
      depth++
    }
  }
  return -1
}

// Wikipedia mobile HTML places <figure> elements AFTER the <p> text in each
// section. Float only affects content that comes after the float in the DOM,
// so figures must precede the text they float beside.
// Processes only leaf sections (no nested <section>) to preserve subsection
// structure; the outer sections that contain subsections are left unchanged.
function hoistThumbnailsBeforeText(html: string): string {
  return html.replace(
    /<section\b([^>]*)>((?:(?!<\/?section\b)[\s\S])*?)<\/section>/g,
    (match, attrs, body) => {
      if (!body.includes('wh-thumb')) return match
      const figures: string[] = []
      const stripped = body.replace(
        /<figure\b[^>]*\bwh-thumb\b[^>]*>[\s\S]*?<\/figure>/g,
        (m: string) => { figures.push(m); return '' }
      )
      if (!figures.length) return match
      const joined = figures.join('')
      const newBody = stripped.includes('<p')
        ? stripped.replace(/(<p[\s>])/, joined + '$1')
        : joined + stripped
      return `<section${attrs}>${newBody}</section>`
    }
  )
}
