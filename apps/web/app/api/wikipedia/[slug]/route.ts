import { NextResponse } from 'next/server'
import { processArticle } from '@/lib/processArticle'

const MAX_SLUG_LENGTH = 512
const MAX_ARTICLE_BYTES = 5_000_000 // 5 MB

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  const { slug } = params

  // Reject slugs that are too long or contain control characters
  if (!slug || slug.length > MAX_SLUG_LENGTH || /[\x00-\x1F\x7F]/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const url = `https://en.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(slug)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'Api-User-Agent': 'Wikihole/1.0 (collaborative-browsing)',
        Accept: 'text/html; charset=utf-8',
      },
      redirect: 'follow',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to reach Wikipedia' }, { status: 502 })
  }

  if (!res.ok) {
    const status = res.status === 404 ? 404 : 502
    return NextResponse.json({ error: `Wikipedia returned ${res.status}` }, { status })
  }

  // Guard against extremely large articles exhausting server memory
  const contentLength = Number(res.headers.get('content-length') ?? 0)
  if (contentLength > MAX_ARTICLE_BYTES) {
    return NextResponse.json({ error: 'Article too large' }, { status: 502 })
  }

  const rawHtml = await res.text()
  const article = processArticle(rawHtml, slug)

  return NextResponse.json(article, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
