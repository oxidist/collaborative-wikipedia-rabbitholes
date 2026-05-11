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

  // Rewrite internal wiki links: href="/wiki/Slug" → href="#" data-wiki-slug="Slug"
  // Handles fragments (/wiki/Slug#Section) and query strings (/wiki/Slug?action=...)
  let html = bodyHtml.replace(
    /href="\/wiki\/([^"#?]+)[^"]*"/g,
    'href="#" data-wiki-slug="$1"',
  )

  // External links open in new tab
  html = html.replace(
    /(<a\s[^>]*href="https?:\/\/[^"]*"[^>]*)>/gi,
    '$1 target="_blank" rel="noopener noreferrer">',
  )

  // Sanitize: allow a broad but safe set of tags, strip scripts/styles/chrome
  html = sanitizeHtml(html, {
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
    exclusiveFilter: (frame) => {
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
