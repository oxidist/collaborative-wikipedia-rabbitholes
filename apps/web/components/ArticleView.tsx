'use client'

import { memo, useEffect, useRef, useCallback } from 'react'
import styles from './ArticleView.module.css'

interface ArticleViewProps {
  html: string
  onWikiLinkClick: (slug: string) => void
  isTransitioning: boolean
  isCached: (slug: string) => boolean
}

export const ArticleView = memo(function ArticleView({
  html,
  onWikiLinkClick,
  isTransitioning,
  isCached,
}: ArticleViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onClickRef = useRef(onWikiLinkClick)
  onClickRef.current = onWikiLinkClick
  const isCachedRef = useRef(isCached)
  isCachedRef.current = isCached
  const prefetchMapRef = useRef<Map<string, AbortController>>(new Map())

  const handleClick = useCallback((e: MouseEvent) => {
    const toggle = (e.target as HTMLElement).closest('[data-infobox-toggle]') as HTMLElement | null
    if (toggle) {
      const cluster = toggle.closest('.wh-infobox-cluster') as HTMLElement | null
      if (cluster) {
        const expanded = cluster.classList.toggle('wh-expanded')
        toggle.textContent = expanded ? 'Hide infobox' : 'Show infobox'
      }
      return
    }
    const target = (e.target as HTMLElement).closest('[data-wiki-slug]') as HTMLElement | null
    if (!target) return
    // Don't intercept middle-click or Ctrl+click (open in new tab)
    if (e.ctrlKey || e.metaKey || e.button !== 0) return
    e.preventDefault()
    const slug = target.dataset.wikiSlug
    if (slug) onClickRef.current(slug)
  }, [])

  const handlePointerOver = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const target = (e.target as HTMLElement).closest('[data-wiki-slug]') as HTMLElement | null
    if (!target) return
    const slug = target.dataset.wikiSlug
    if (!slug) return
    if (isCachedRef.current(slug)) return
    if (prefetchMapRef.current.has(slug)) return
    const controller = new AbortController()
    prefetchMapRef.current.set(slug, controller)
    fetch(`/api/wikipedia/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .catch(() => {})
      .finally(() => { prefetchMapRef.current.delete(slug) })
  }, [])

  const handlePointerOut = useCallback((e: PointerEvent) => {
    const target = (e.target as HTMLElement).closest('[data-wiki-slug]') as HTMLElement | null
    if (!target) return
    if (target.contains(e.relatedTarget as Node | null)) return
    const slug = target.dataset.wikiSlug
    if (!slug) return
    const controller = prefetchMapRef.current.get(slug)
    if (controller) {
      controller.abort()
      prefetchMapRef.current.delete(slug)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('click', handleClick)
    el.addEventListener('pointerover', handlePointerOver)
    el.addEventListener('pointerout', handlePointerOut)
    return () => {
      el.removeEventListener('click', handleClick)
      el.removeEventListener('pointerover', handlePointerOver)
      el.removeEventListener('pointerout', handlePointerOut)
    }
  }, [handleClick, handlePointerOver, handlePointerOut])

  useEffect(() => {
    return () => {
      prefetchMapRef.current.forEach((c) => c.abort())
      prefetchMapRef.current.clear()
    }
  }, [])

  // Scroll to top on article change
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [html])

  return (
    <div className="article-container">
      <div
        ref={containerRef}
        className={[styles.article, isTransitioning && styles.transitioning].filter(Boolean).join(' ')}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
})
