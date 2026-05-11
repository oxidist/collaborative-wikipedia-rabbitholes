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
      a: ['href', 'data-wiki-slug', 'class', 'id', 'rel', 'target'],
      img: ['src', 'srcset', 'alt', 'width', 'height', 'class', 'loading'],
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
          return {
            tagName,
            attribs: { ...attribs, href: '#', 'data-wiki-slug': wikiSlug },
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
