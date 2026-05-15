import { describe, it, expect } from 'vitest'
import { buildTocNumbers } from '../components/TableOfContents'
import type { TocEntry } from '../lib/processArticle'

describe('buildTocNumbers', () => {
  it('numbers a flat list of h2 entries', () => {
    const toc: TocEntry[] = [
      { id: 'a', text: 'A', level: 2 },
      { id: 'b', text: 'B', level: 2 },
    ]
    expect(buildTocNumbers(toc)).toEqual(['1.', '2.'])
  })

  it('numbers h3 entries as sub-items under their preceding h2', () => {
    const toc: TocEntry[] = [
      { id: 'a', text: 'A', level: 2 },
      { id: 'a1', text: 'A1', level: 3 },
      { id: 'a2', text: 'A2', level: 3 },
      { id: 'b', text: 'B', level: 2 },
      { id: 'b1', text: 'B1', level: 3 },
    ]
    expect(buildTocNumbers(toc)).toEqual(['1.', '1.1', '1.2', '2.', '2.1'])
  })

  it('resets the h3 counter when a new h2 is encountered', () => {
    const toc: TocEntry[] = [
      { id: 'a', text: 'A', level: 2 },
      { id: 'a1', text: 'A1', level: 3 },
      { id: 'b', text: 'B', level: 2 },
      { id: 'b1', text: 'B1', level: 3 },
    ]
    expect(buildTocNumbers(toc)).toEqual(['1.', '1.1', '2.', '2.1'])
  })

  it('returns empty array for empty input', () => {
    expect(buildTocNumbers([])).toEqual([])
  })

  it('skips numbering for h3 entries that appear before any h2', () => {
    const toc: TocEntry[] = [
      { id: 'early', text: 'Early', level: 3 },
      { id: 'a', text: 'A', level: 2 },
      { id: 'a1', text: 'A1', level: 3 },
    ]
    expect(buildTocNumbers(toc)).toEqual(['', '1.', '1.1'])
  })
})
