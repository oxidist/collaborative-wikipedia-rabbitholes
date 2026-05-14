import type { ProcessedArticle } from './processArticle'

const TTL_MS = 60_000
const MAX_ENTRIES = 200

interface Entry {
  value: ProcessedArticle
  expiresAt: number
}

const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<ProcessedArticle>>()

export function getCached(slug: string): ProcessedArticle | undefined {
  const entry = cache.get(slug)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(slug)
    return undefined
  }
  // Re-insert to mark MRU
  cache.delete(slug)
  cache.set(slug, entry)
  return entry.value
}

export function setCached(slug: string, value: ProcessedArticle): void {
  cache.set(slug, { value, expiresAt: Date.now() + TTL_MS })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function coalesce(
  slug: string,
  fn: () => Promise<ProcessedArticle>,
): Promise<ProcessedArticle> {
  const existing = inFlight.get(slug)
  if (existing) return existing
  const promise = (async () => {
    try {
      return await fn()
    } finally {
      inFlight.delete(slug)
    }
  })()
  inFlight.set(slug, promise)
  return promise
}

// Test-only helper.
export function _resetArticleCache(): void {
  cache.clear()
  inFlight.clear()
}
