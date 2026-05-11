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

  it('strips fragment from rewritten link slug', () => {
    const html = '<a href="./Cephalopod#Anatomy">Anatomy</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('#Anatomy')
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
})
