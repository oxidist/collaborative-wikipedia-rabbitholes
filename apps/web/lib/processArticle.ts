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
        // Substring after #fragment and ?query are stripped, result is URI-decoded
        const internalMatch = href.match(/^(?:\.\/|\/wiki\/)([^#?]*)/)
        if (internalMatch) {
          let wikiSlug: string
          try {
            wikiSlug = decodeURIComponent(internalMatch[1])
          } catch {
            wikiSlug = internalMatch[1]
          }
          // Skip non-article namespaces (File:, Special:, Help:, etc.)
          if (/^[A-Z][a-zA-Z]+:/.test(wikiSlug)) {
            const { href: _removed, ...rest } = attribs
            return { tagName, attribs: rest }
          }
          // No href — prevents hash/router navigation when clicked.
          // ArticleView intercepts via data-wiki-slug; tabindex keeps keyboard access.
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
        cls.includes('reflist') ||
        cls.includes('mw-references-wrap') ||
        cls.includes('printfooter') ||
        cls.includes('catlinks') ||
        id === 'toc'
      )
    },
  })

  return { html, title, slug }
}
