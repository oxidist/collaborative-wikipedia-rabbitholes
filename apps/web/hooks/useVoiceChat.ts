'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { ClientMessage, ServerMessage } from '@wikihole/types'
import { VoiceChatSession, type VoiceState } from '@/lib/voiceChatSession'

interface UseVoiceChatOptions {
  roomId: string
  sendSignal: (msg: ClientMessage) => void
}

interface UseVoiceChatReturn extends VoiceState {
  join: () => Promise<void>
  leave: () => void
  toggleMute: () => void
  handleSignal: (msg: ServerMessage) => void
}

const INITIAL_STATE: VoiceState = {
  joined: false, muted: false, speaking: false, remoteSpeaking: false, permissionDenied: false,
}

export function useVoiceChat({ roomId, sendSignal }: UseVoiceChatOptions): UseVoiceChatReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>(INITIAL_STATE)

  const sessionRef = useRef<VoiceChatSession | null>(null)
  // Stores an incoming voice-offer that arrived before the user clicked "Join voice"
  const pendingOfferRef = useRef<string | null>(null)
  const sendSignalRef = useRef(sendSignal)
  sendSignalRef.current = sendSignal

  useEffect(() => {
    return () => {
      sessionRef.current?.leave()
    }
  }, [])

  const join = useCallback(async () => {
    const session = new VoiceChatSession(
      roomId,
      (msg) => sendSignalRef.current(msg),
      setVoiceState,
    )
    sessionRef.current = session

    if (pendingOfferRef.current) {
      const sdp = pendingOfferRef.current
      pendingOfferRef.current = null
      await session.handleOffer(sdp)
    } else {
      await session.join()
    }
  }, [roomId])

  const leave = useCallback(() => {
    sessionRef.current?.leave()
    sessionRef.current = null
    pendingOfferRef.current = null
    setVoiceState(INITIAL_STATE)
  }, [])

  const toggleMute = useCallback(() => {
    sessionRef.current?.toggleMute()
  }, [])

  const handleSignal = useCallback((msg: ServerMessage) => {
    if (msg.type === 'voice-offer') {
      if (sessionRef.current) {
        void sessionRef.current.handleOffer(msg.sdp)
      } else {
        // User hasn't joined yet — store offer so join() can use it
        pendingOfferRef.current = msg.sdp
      }
    } else if (msg.type === 'voice-answer') {
      void sessionRef.current?.handleAnswer(msg.sdp)
    } else if (msg.type === 'voice-ice') {
      void sessionRef.current?.handleIce(msg.candidate)
    } else if (msg.type === 'voice-state') {
      // Remote mute state — update UI only (we don't suppress their audio)
      setVoiceState((prev) => ({ ...prev, remoteSpeaking: !msg.muted && prev.remoteSpeaking }))
    }
  }, [])

  return { ...voiceState, join, leave, toggleMute, handleSignal }
}
