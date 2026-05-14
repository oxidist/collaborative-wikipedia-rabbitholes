import { useEffect, useRef, useState } from 'react'

interface NavigationTrailProps {
  trail: string[]
  currentSlug: string
  onNavigate: (slug: string) => void
}

export function slugToLabel(slug: string): string {
  return slug.replace(/_/g, ' ')
}

export function buildExportText(trail: string[]): string {
  return trail.map(slugToLabel).join(' → ')
}

export function NavigationTrail({ trail, currentSlug, onNavigate }: NavigationTrailProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [exported, setExported] = useState(false)
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current)
    }
  }, [])

  // Pin the rightmost entry visible on update
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [trail.length])

  if (trail.length === 0) return null

  // Treat the last occurrence of currentSlug as the "current" entry. Anything
  // after it (which shouldn't normally exist) is rendered as past too.
  let currentIndex = trail.lastIndexOf(currentSlug)
  if (currentIndex === -1) currentIndex = trail.length - 1

  function handleExport() {
    navigator.clipboard.writeText(buildExportText(trail)).then(() => {
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current)
      setExported(true)
      exportTimerRef.current = setTimeout(() => setExported(false), 2000)
    }).catch(() => {})
  }

  return (
    <nav className="nav-trail" aria-label="Navigation trail">
      <div className="nav-trail__scroll" ref={scrollRef}>
        <ol className="nav-trail__list">
          {trail.map((slug, i) => {
            const isCurrent = i === currentIndex
            const isLast = i === trail.length - 1
            return (
              <li key={`${i}-${slug}`} className="nav-trail__item">
                {isCurrent ? (
                  <span className="nav-trail__entry nav-trail__entry--current" aria-current="page">
                    {slugToLabel(slug)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="nav-trail__entry nav-trail__entry--past"
                    onClick={() => onNavigate(slug)}
                  >
                    {slugToLabel(slug)}
                  </button>
                )}
                {!isLast && <span className="nav-trail__sep" aria-hidden="true">›</span>}
              </li>
            )
          })}
        </ol>
      </div>
      <button
        type="button"
        className="nav-trail__export"
        onClick={handleExport}
        aria-label="Copy trail to clipboard"
      >
        {exported ? 'Copied!' : 'Export'}
      </button>
    </nav>
  )
}
