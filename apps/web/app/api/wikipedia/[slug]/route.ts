import { NextRequest, NextResponse } from 'next/server'
import { processArticle } from '@/lib/processArticle'

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const { slug } = params

  if (!slug || !/^[^/]+$/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(slug)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'Api-User-Agent': 'Wikihole/1.0 (collaborative-browsing)',
        'Accept': 'text/html; charset=utf-8',
      },
      // Follow redirects (Wikipedia redirects article aliases)
      redirect: 'follow',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to reach Wikipedia' }, { status: 502 })
  }

  if (!res.ok) {
    const status = res.status === 404 ? 404 : 502
    return NextResponse.json({ error: `Wikipedia returned ${res.status}` }, { status })
  }

  const rawHtml = await res.text()
  const article = processArticle(rawHtml, slug)

  return NextResponse.json(article)
}
