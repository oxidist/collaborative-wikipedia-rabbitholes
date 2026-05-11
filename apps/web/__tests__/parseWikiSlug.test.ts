import { describe, it, expect } from 'vitest'
import { parseWikiSlug } from '../lib/parseWikiSlug'

describe('parseWikiSlug', () => {
  it('extracts slug from a full Wikipedia URL', () => {
    expect(parseWikiSlug('https://en.wikipedia.org/wiki/Octopus')).toBe('Octopus')
  })

  it('handles percent-encoded Wikipedia URL and returns decoded slug', () => {
    expect(parseWikiSlug('https://en.wikipedia.org/wiki/Six_degrees_of_Wikipedia')).toBe('Six_degrees_of_Wikipedia')
  })

  it('returns null for a non-wikipedia URL', () => {
    expect(parseWikiSlug('https://example.com/wiki/Foo')).toBeNull()
  })

  it('returns a bare slug as-is', () => {
    expect(parseWikiSlug('Octopus')).toBe('Octopus')
  })

  it('returns null for a bare slug with a space', () => {
    expect(parseWikiSlug('Eiffel Tower')).toBeNull()
  })

  it('returns null for a bare slug with a slash', () => {
    expect(parseWikiSlug('Foo/Bar')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseWikiSlug('')).toBeNull()
  })

  it('returns null for a Wikipedia URL with no /wiki/ path', () => {
    expect(parseWikiSlug('https://en.wikipedia.org/')).toBeNull()
  })
})
