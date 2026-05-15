import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessedArticle } from '../lib/processArticle'
import {
  _resetArticleCache,
  coalesce,
  getCached,
  setCached,
} from '../lib/articleCache'

function article(slug: string): ProcessedArticle {
  return { slug, title: slug, html: `<p>${slug}</p>`, toc: [] }
}

beforeEach(() => {
  _resetArticleCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('articleCache', () => {
  it('returns undefined for a missing slug', () => {
    expect(getCached('Nope')).toBeUndefined()
  })

  it('round-trips a value', () => {
    const a = article('Einstein')
    setCached('Einstein', a)
    expect(getCached('Einstein')).toBe(a)
  })

  it('expires entries after the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    setCached('Einstein', article('Einstein'))
    vi.setSystemTime(new Date('2026-01-01T00:04:59Z'))
    expect(getCached('Einstein')).toBeDefined()
    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'))
    expect(getCached('Einstein')).toBeUndefined()
  })

  it('evicts the least-recently-used entry past the cap', () => {
    // The cap is 200; insert 201 distinct slugs, then verify the first is gone.
    for (let i = 0; i < 201; i++) {
      setCached(`slug-${i}`, article(`slug-${i}`))
    }
    expect(getCached('slug-0')).toBeUndefined()
    expect(getCached('slug-200')).toBeDefined()
  })

  it('marks an entry MRU on read so it survives eviction', () => {
    for (let i = 0; i < 200; i++) {
      setCached(`slug-${i}`, article(`slug-${i}`))
    }
    // Touch slug-0 to mark it MRU.
    expect(getCached('slug-0')).toBeDefined()
    // Insert one more — slug-1 should be evicted, not slug-0.
    setCached('slug-200', article('slug-200'))
    expect(getCached('slug-0')).toBeDefined()
    expect(getCached('slug-1')).toBeUndefined()
  })

  it('coalesces concurrent calls for the same slug into one fn invocation', async () => {
    let calls = 0
    let resolve!: (a: ProcessedArticle) => void
    const fn = () => {
      calls++
      return new Promise<ProcessedArticle>((r) => {
        resolve = r
      })
    }
    const p1 = coalesce('Einstein', fn)
    const p2 = coalesce('Einstein', fn)
    expect(calls).toBe(1)
    resolve(article('Einstein'))
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(r2)
  })

  it('releases the in-flight slot after the promise settles', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return article('Einstein')
    }
    await coalesce('Einstein', fn)
    await coalesce('Einstein', fn)
    expect(calls).toBe(2)
  })

  it('releases the in-flight slot even when fn rejects', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw new Error('boom')
    }
    await expect(coalesce('Einstein', fn)).rejects.toThrow('boom')
    await expect(coalesce('Einstein', fn)).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })
})
