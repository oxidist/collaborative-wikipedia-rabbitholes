import { describe, it, expect } from 'vitest'
import { processArticle } from '../lib/processArticle'

describe('processArticle', () => {
  it('extracts the title from the first h1', () => {
    const html = '<h1 id="firstHeading">Octopus</h1><p>Some text.</p>'
    const result = processArticle(html, 'Octopus')
    expect(result.title).toBe('Octopus')
  })

  it('strips inner HTML tags from extracted title', () => {
    const html = '<h1><i>Octopus</i></h1><p>Text.</p>'
    const result = processArticle(html, 'Octopus')
    expect(result.title).toBe('Octopus')
  })

  it('falls back to slug-derived title if no h1', () => {
    const result = processArticle('<p>No heading.</p>', 'Six_degrees_of_Wikipedia')
    expect(result.title).toBe('Six degrees of Wikipedia')
  })

  it('rewrites classic /wiki/ links to data-wiki-slug (no href)', () => {
    const html = '<a href="/wiki/Cephalopod">Cephalopod</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('href="/wiki/')
    expect(result.html).not.toContain('href="#"')
  })

  it('rewrites Parsoid ./Slug format links (actual Wikipedia API output)', () => {
    const html = '<a href="./Cephalopod">Cephalopod</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('href=')
  })

  it('strips fragment from cross-page link slug', () => {
    const html = '<a href="./Cephalopod#Anatomy">Anatomy</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('#Anatomy')
  })

  it('preserves same-page fragment as plain href (footnote forward-link)', () => {
    // Wikipedia mobile HTML: footnotes use ./Article#cite_note-X, not bare #cite_note-X
    const html = '<sup><a href="./Octopus#cite_note-1">[1]</a></sup>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('href="#cite_note-1"')
    expect(result.html).not.toContain('data-wiki-slug')
  })

  it('preserves same-page fragment for /wiki/ format links', () => {
    const html = '<a href="/wiki/Octopus#cite_note-2">[2]</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('href="#cite_note-2"')
    expect(result.html).not.toContain('data-wiki-slug')
  })

  it('decodes percent-encoded slugs in data-wiki-slug', () => {
    const html = '<a href="./Caf%C3%A9">Café</a>'
    const result = processArticle(html, 'Food')
    expect(result.html).toContain('data-wiki-slug="Café"')
  })

  it('does not rewrite external links but adds target=_blank and noopener', () => {
    const html = '<a href="https://example.com">external</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('href="https://example.com"')
    expect(result.html).toContain('target="_blank"')
    expect(result.html).toContain('noopener')
    expect(result.html).toContain('noreferrer')
  })

  it('merges noopener/noreferrer into existing rel on external links', () => {
    const html = '<a href="https://example.com" rel="nofollow">external</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('nofollow')
    expect(result.html).toContain('noopener')
    expect(result.html).toContain('noreferrer')
  })

  it('strips mw-editsection spans and their content', () => {
    const html = '<h2>Section<span class="mw-editsection">[<a href="/w/edit">edit</a>]</span></h2>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).not.toContain('mw-editsection')
    expect(result.html).not.toContain('edit')
  })

  it('strips script tags and their content', () => {
    const html = '<p>Text</p><script>alert("xss")</script>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('alert')
  })

  it('extracts body content from a full HTML document', () => {
    const html = '<html><head><title>ignored</title></head><body><p>content</p></body></html>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('content')
    expect(result.html).not.toContain('ignored')
  })

  it('returns the original slug', () => {
    const result = processArticle('<p>text</p>', 'My_Article')
    expect(result.slug).toBe('My_Article')
  })

  it('adds loading=lazy to images that do not have a loading attribute', () => {
    const html = '<img src="https://upload.wikimedia.org/photo.jpg" alt="photo" width="200" height="100">'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('loading="lazy"')
  })

  it('does not duplicate loading attribute on images that already have one', () => {
    const html = '<img src="https://upload.wikimedia.org/photo.jpg" alt="photo" loading="eager">'
    const result = processArticle(html, 'Test')
    const matches = result.html.match(/loading=/g)
    expect(matches).toHaveLength(1)
    expect(result.html).toContain('loading="lazy"')
  })

  it('strips srcset from images', () => {
    const html = '<img src="https://upload.wikimedia.org/small.jpg" srcset="https://upload.wikimedia.org/large.jpg 2x" alt="photo">'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('srcset')
    expect(result.html).toContain('src="https://upload.wikimedia.org/small.jpg"')
  })

  it('promotes data-src to src for Wikipedia lazy-loaded images', () => {
    const html = '<img src="data:image/gif;base64,R0lGODlh" data-src="https://upload.wikimedia.org/real.jpg" alt="photo">'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('src="https://upload.wikimedia.org/real.jpg"')
    expect(result.html).not.toContain('data-src')
    expect(result.html).not.toContain('R0lGODlh')
  })

  it('converts Wikipedia span placeholders with data-src into img tags', () => {
    const html = '<figure><span data-src="//upload.wikimedia.org/photo.jpg" data-width="500" data-height="300" data-class="mw-file-element"></span></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('<img')
    expect(result.html).toContain('src="//upload.wikimedia.org/photo.jpg"')
    expect(result.html).toContain('width="500"')
    expect(result.html).toContain('height="300"')
    expect(result.html).not.toContain('data-src')
  })

  it('preserves the references section (reflist)', () => {
    const html = `
      <p>Text with a footnote.<sup><a href="#cite_note-1">[1]</a></sup></p>
      <div class="reflist">
        <ol>
          <li id="cite_note-1"><a href="#cite_ref-1">↑</a> Smith, J. (2020). <i>A Book</i>.</li>
        </ol>
      </div>
    `
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('id="cite_note-1"')
    expect(result.html).toContain('Smith, J.')
  })

  it('preserves footnote fragment hrefs so jump-to-reference works', () => {
    const html = `<p><sup><a href="#cite_note-1">[1]</a></sup></p>
      <div class="mw-references-wrap"><ol><li id="cite_note-1">Ref text.</li></ol></div>`
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('href="#cite_note-1"')
    expect(result.html).toContain('id="cite_note-1"')
  })

  it('adds wh-thumb class to figure[typeof="mw:File/Thumb"] thumbnails', () => {
    const html = '<figure typeof="mw:File/Thumb" class="mw-default-size"><img src="photo.jpg" alt=""><figcaption>Cap</figcaption></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('wh-thumb')
    expect(result.html).toContain('mw-default-size')
  })

  it('does not add wh-thumb to non-thumbnail figures', () => {
    const html = '<figure class="mw-gallery"><img src="photo.jpg" alt=""></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('wh-thumb')
  })

  it('adds wh-thumb and preserves mw-halign-left for left-floating thumbnails', () => {
    const html = '<figure typeof="mw:File/Thumb" class="mw-halign-left pcs-widen-image-ancestor"><img src="photo.jpg" alt=""></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('wh-thumb')
    expect(result.html).toContain('mw-halign-left')
  })
})
