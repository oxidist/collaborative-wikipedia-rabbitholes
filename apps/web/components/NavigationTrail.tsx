import { useEffect, useRef } from 'react'

interface NavigationTrailProps {
  trail: string[]
  currentSlug: string
  onNavigate: (slug: string) => void
}

export function slugToLabel(slug: string): string {
  return slug.replace(/_/g, ' ')
}

export function NavigationTrail({ trail, currentSlug, onNavigate }: NavigationTrailProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

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

  return (
    <nav className="nav-trail" aria-label="Navigation trail" ref={scrollRef}>
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
    </nav>
  )
}
