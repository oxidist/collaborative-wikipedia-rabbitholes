'use client'

import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { ServerMessage } from '@wikihole/types'
import { ArticleView } from '@/components/ArticleView'
import { RoomBar } from '@/components/RoomBar'
import { NavigationTrail } from '@/components/NavigationTrail'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { useRoom } from '@/hooks/useRoom'
import { useVoiceChat } from '@/hooks/useVoiceChat'
import { TableOfContents } from '@/components/TableOfContents'
import type { TocEntry } from '@/lib/processArticle'

interface ArticleData {
  html: string
  title: string
  slug: string
  toc: TocEntry[]
}

async function fetchArticle(slug: string): Promise<ArticleData> {
  const res = await fetch(`/api/wikipedia/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`)
  return res.json() as Promise<ArticleData>
}

function RoomContent() {
  const { id: roomId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const initialSlug = searchParams.get('article') ?? ''

  const [article, setArticle] = useState<ArticleData | null>(null)
  const [articleError, setArticleError] = useState(false)
  const [history, setHistory] = useState<ArticleData[]>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  const articleRef = useRef<ArticleData | null>(null)
  const loadingSlugRef = useRef<string | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const articleMapRef = useRef<Map<string, ArticleData>>(new Map())

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    }
  }, [])

  const loadArticle = useCallback(async (slug: string) => {
    if (!slug) return

    const cached = articleMapRef.current.get(slug)
    if (cached) {
      setArticleError(false)
      const prev = articleRef.current
      if (prev && prev.slug !== slug) {
        setHistory((h) => [...h, prev])
      }
      articleRef.current = cached
      setArticle(cached)
      return
    }

    loadingSlugRef.current = slug
    setArticleError(false)
    setIsTransitioning(true)
    try {
      const data = await fetchArticle(slug)
      articleMapRef.current.set(slug, data)
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

  useEffect(() => {
    if (initialSlug) {
      void loadArticle(initialSlug)
    }
  }, [initialSlug, loadArticle])

  const { participantCount, trail, navigate, sendSignal, connectionLost, retry } = useRoom({
    roomId,
    initialSlug,
    onMessage: handleServerMessage,
  })

  const voice = useVoiceChat({ roomId, sendSignal })

  // Stable ref so handleServerMessage can call handleSignal without being recreated
  const voiceHandleSignalRef = useRef(voice.handleSignal)
  voiceHandleSignalRef.current = voice.handleSignal

  function handleServerMessage(msg: ServerMessage) {
    if (msg.type === 'sync' || msg.type === 'navigate') {
      if (msg.slug !== loadingSlugRef.current && msg.slug !== articleRef.current?.slug) {
        loadArticle(msg.slug)
      }
    } else if (
      msg.type === 'voice-offer' ||
      msg.type === 'voice-answer' ||
      msg.type === 'voice-ice' ||
      msg.type === 'voice-state'
    ) {
      voiceHandleSignalRef.current(msg)
    }
  }

  const handleWikiLinkClick = useCallback((slug: string) => {
    navigate(slug)
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
          voiceJoined={voice.joined}
          voiceMuted={voice.muted}
          voiceSpeaking={voice.speaking}
          voiceRemoteSpeaking={voice.remoteSpeaking}
          voicePermissionDenied={voice.permissionDenied}
          onJoinVoice={() => { void voice.join() }}
          onLeaveVoice={voice.leave}
          onToggleMute={voice.toggleMute}
        />
      )}
      {article && trail.length > 0 && (
        <NavigationTrail trail={trail} currentSlug={article.slug} onNavigate={handleWikiLinkClick} />
      )}
      {articleError ? (
        <div className="article-error" role="alert">
          <p>Couldn&apos;t load this article.</p>
          {history.length > 0 && (
            <button onClick={handleBack}>Go back</button>
          )}
        </div>
      ) : article ? (
        article.toc.length > 0 ? (
          <div className="room-content-layout">
            <TableOfContents key={article.slug} toc={article.toc} />
            <ArticleView
              html={article.html}
              onWikiLinkClick={handleWikiLinkClick}
              isTransitioning={isTransitioning}
            />
          </div>
        ) : (
          <ArticleView
            html={article.html}
            onWikiLinkClick={handleWikiLinkClick}
            isTransitioning={isTransitioning}
          />
        )
      ) : isTransitioning || initialSlug ? (
        <p className="article-loading" aria-live="polite">Loading…</p>
      ) : (
        <p className="article-waiting" aria-live="polite">Waiting for host…</p>
      )}
    </>
  )
}

export default function RoomPage() {
  return (
    <Suspense fallback={<p className="article-loading" aria-live="polite">Loading…</p>}>
      <RoomContent />
    </Suspense>
  )
}
