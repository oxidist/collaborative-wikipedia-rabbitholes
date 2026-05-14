import { NextResponse } from 'next/server'
import { processArticle, type ProcessedArticle } from '@/lib/processArticle'
import { coalesce, getCached, setCached } from '@/lib/articleCache'

const MAX_SLUG_LENGTH = 512
const MAX_ARTICLE_BYTES = 5_000_000 // 5 MB

const USER_AGENT =
  'Wikihole/1.0 (https://github.com/oxidist/collaborative-wikipedia-rabbitholes; contact via repo issues)'

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function fetchAndProcess(slug: string): Promise<ProcessedArticle> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(slug)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Api-User-Agent': 'Wikihole/1.0 (collaborative-browsing)',
        Accept: 'text/html; charset=utf-8',
      },
      redirect: 'follow',
    })
  } catch {
    throw new UpstreamError('Failed to reach Wikipedia', 502)
  }

  if (!res.ok) {
    const status = res.status === 404 ? 404 : 502
    throw new UpstreamError(`Wikipedia returned ${res.status}`, status)
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0)
  if (contentLength > MAX_ARTICLE_BYTES) {
    throw new UpstreamError('Article too large', 502)
  }

  const rawHtml = await res.text()
  return processArticle(rawHtml, slug)
}

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  const { slug } = params

  if (!slug || slug.length > MAX_SLUG_LENGTH || /[\x00-\x1F\x7F]/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const cached = getCached(slug)
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    })
  }

  let article: ProcessedArticle
  try {
    article = await coalesce(slug, () => fetchAndProcess(slug))
  } catch (err) {
    if (err instanceof UpstreamError) {
      const message = err.status === 404 ? 'Article not found' : err.message
      return NextResponse.json({ error: message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  setCached(slug, article)

  return NextResponse.json(article, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
