import { useState, useRef, useEffect } from 'react'

interface RoomBarProps {
  title: string
  participantCount: number
  canGoBack: boolean
  onBack: () => void
  voiceJoined: boolean
  voiceMuted: boolean
  voiceSpeaking: boolean
  voiceRemoteSpeaking: boolean
  voicePermissionDenied: boolean
  onJoinVoice: () => void
  onLeaveVoice: () => void
  onToggleMute: () => void
}

export function RoomBar({
  title,
  participantCount,
  canGoBack,
  onBack,
  voiceJoined,
  voiceMuted,
  voiceSpeaking,
  voiceRemoteSpeaking,
  voicePermissionDenied,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
}: RoomBarProps) {
  const [copied, setCopied] = useState(false)
  const [micDenied, setMicDenied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const micDeniedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      if (micDeniedTimerRef.current) clearTimeout(micDeniedTimerRef.current)
    }
  }, [])

  // Show "Mic access denied" feedback when permission is denied
  useEffect(() => {
    if (!voicePermissionDenied) return
    setMicDenied(true)
    micDeniedTimerRef.current = setTimeout(() => setMicDenied(false), 2000)
  }, [voicePermissionDenied])

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
      {participantCount > 1 && (
        voiceJoined ? (
          <span className="room-bar__voice-controls">
            <span
              className={`room-bar__voice-dot ${voiceSpeaking ? 'room-bar__voice-dot--active' : ''}`}
              aria-label={voiceSpeaking ? 'You are speaking' : 'You are silent'}
            />
            <span
              className={`room-bar__voice-dot ${voiceRemoteSpeaking ? 'room-bar__voice-dot--active' : ''}`}
              aria-label={voiceRemoteSpeaking ? 'Other participant speaking' : 'Other participant silent'}
            />
            <button className="room-bar__voice-btn" onClick={onToggleMute}>
              {voiceMuted ? 'Unmute' : 'Mute'}
            </button>
            <button className="room-bar__voice-leave" onClick={onLeaveVoice}>
              Leave
            </button>
          </span>
        ) : micDenied ? (
          <span className="room-bar__voice-denied" aria-live="polite">Mic access denied</span>
        ) : (
          <button className="room-bar__voice-join" onClick={onJoinVoice}>
            🎙 Join voice
          </button>
        )
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
