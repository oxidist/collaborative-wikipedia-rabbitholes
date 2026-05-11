'use client'

import { useEffect, useRef, useCallback } from 'react'
import styles from './ArticleView.module.css'

interface ArticleViewProps {
  html: string
  onWikiLinkClick: (slug: string) => void
  isTransitioning: boolean
}

export function ArticleView({ html, onWikiLinkClick, isTransitioning }: ArticleViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Keep a stable ref so the event listener doesn't need re-registration on each render
  const onClickRef = useRef(onWikiLinkClick)
  onClickRef.current = onWikiLinkClick

  const handleClick = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-wiki-slug]') as HTMLElement | null
    if (!target) return
    // Don't intercept middle-click or Ctrl+click (open in new tab)
    if (e.ctrlKey || e.metaKey || e.button !== 0) return
    e.preventDefault()
    const slug = target.dataset.wikiSlug
    if (slug) onClickRef.current(slug)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [handleClick]) // listener is on the stable container div, not the injected content

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
}
