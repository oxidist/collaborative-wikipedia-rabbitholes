'use client'

import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { ServerMessage } from '@wikihole/types'
import { ArticleView } from '@/components/ArticleView'
import { RoomBar } from '@/components/RoomBar'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { useRoom } from '@/hooks/useRoom'

interface ArticleData {
  html: string
  title: string
  slug: string
}

async function fetchArticle(slug: string): Promise<ArticleData> {
  const res = await fetch(`/api/wikipedia/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`)
  return res.json() as Promise<ArticleData>
}

function RoomContent() {
  const { id: roomId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  // initialSlug: provided by home page (?article=) or empty for late joiners
  const initialSlug = searchParams.get('article') ?? ''

  const [article, setArticle] = useState<ArticleData | null>(null)
  const [articleError, setArticleError] = useState(false)
  const [history, setHistory] = useState<ArticleData[]>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  // Ref to current article — used to push to history without a setState dependency
  const articleRef = useRef<ArticleData | null>(null)
  // Ref tracking which slug is currently being fetched — prevents double-load race
  const loadingSlugRef = useRef<string | null>(null)
  // Ref for the isTransitioning clear timer — prevents state updates on unmounted component
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    }
  }, [])

  const loadArticle = useCallback(async (slug: string) => {
    if (!slug) return
    loadingSlugRef.current = slug
    setArticleError(false)
    setIsTransitioning(true)
    try {
      const data = await fetchArticle(slug)
      const prev = articleRef.current
      if (prev && prev.slug !== slug) {
        setHistory((h) => [...h, prev])
      }
      articleRef.current = data
      setArticle(data)
    } catch {
      setArticleError(true)
    } finally {
      loadingSlugRef.current = null
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = setTimeout(() => setIsTransitioning(false), 200)
    }
  }, [])

  // Both 'sync' (join response) and 'navigate' (peer navigation) trigger a load
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'sync' || msg.type === 'navigate') {
      if (msg.slug !== loadingSlugRef.current) {
        loadArticle(msg.slug)
      }
    }
  }, [loadArticle])

  const { participantCount, navigate, connectionLost, retry } = useRoom({
    roomId,
    initialSlug,
    onMessage: handleServerMessage,
  })

  const handleWikiLinkClick = useCallback((slug: string) => {
    navigate(slug)
    // Optimistically start loading — server will also broadcast back to us,
    // but we load immediately for snappiness
    loadArticle(slug)
  }, [navigate, loadArticle])

  const handleBack = useCallback(() => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    articleRef.current = prev
    setArticle(prev)
    navigate(prev.slug)
  }, [history, navigate])

  return (
    <>
      {connectionLost && <ConnectionBanner onRetry={retry} />}
      {article && (
        <RoomBar
          title={article.title}
          participantCount={participantCount}
          canGoBack={history.length > 0}
          onBack={handleBack}
        />
      )}
      {articleError ? (
        <div className="article-error" role="alert">
          <p>Couldn&apos;t load this article.</p>
          {history.length > 0 && (
            <button onClick={handleBack}>Go back</button>
          )}
        </div>
      ) : article ? (
        <ArticleView
          html={article.html}
          onWikiLinkClick={handleWikiLinkClick}
          isTransitioning={isTransitioning}
        />
      ) : isTransitioning ? (
        <p className="article-loading">Loading…</p>
      ) : (
        <p className="article-waiting">Waiting for host…</p>
      )}
    </>
  )
}

export default function RoomPage() {
  return (
    <Suspense fallback={<p className="article-loading">Loading…</p>}>
      <RoomContent />
    </Suspense>
  )
}
