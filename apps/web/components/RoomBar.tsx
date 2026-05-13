import { useState, useRef } from 'react'

interface RoomBarProps {
  title: string
  participantCount: number
  canGoBack: boolean
  onBack: () => void
}

export function RoomBar({ title, participantCount, canGoBack, onBack }: RoomBarProps) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopied(true)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="room-bar">
      {canGoBack && (
        <button className="room-bar__back" onClick={onBack} aria-label="Go back">
          ← Back
        </button>
      )}
      <span className="room-bar__title" title={title}>{title}</span>
      {participantCount > 1 && (
        <span className="room-bar__people" aria-live="polite">
          {participantCount} here
        </span>
      )}
      <button
        className="room-bar__copy"
        onClick={handleCopy}
        aria-label="Copy room link"
      >
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  )
}
