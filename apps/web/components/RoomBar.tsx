interface RoomBarProps {
  title: string
  participantCount: number
  canGoBack: boolean
  onBack: () => void
}

export function RoomBar({ title, participantCount, canGoBack, onBack }: RoomBarProps) {
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
    </div>
  )
}
