'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { ClientMessage, ServerMessage } from '@wikihole/types'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080'
const MAX_RETRIES = 3

interface UseRoomOptions {
  roomId: string
  initialSlug: string
  onMessage: (msg: ServerMessage) => void
}

interface UseRoomReturn {
  participantCount: number
  navigate: (slug: string) => void
  connectionLost: boolean
  retry: () => void
}

export function useRoom({ roomId, initialSlug, onMessage }: UseRoomOptions): UseRoomReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  // Stable refs for roomId/initialSlug so connect() never needs to be recreated
  // when React re-renders (e.g. due to router state changes from href="#" clicks).
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId
  const initialSlugRef = useRef(initialSlug)
  initialSlugRef.current = initialSlug

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [participantCount, setParticipantCount] = useState(1)
  const [connectionLost, setConnectionLost] = useState(false)

  // connect has [] deps — it never changes identity, so the useEffect below
  // runs exactly once at mount (plus Strict Mode's simulated unmount/remount).
  // roomId and initialSlug are read from refs at the moment they're needed.
  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      retriesRef.current = 0
      setConnectionLost(false)
      const msg: ClientMessage = {
        type: 'join',
        roomId: roomIdRef.current,
        articleSlug: initialSlugRef.current || undefined,
      }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data as string) as ServerMessage
      } catch {
        return
      }
      if (msg.type === 'participants') {
        setParticipantCount(msg.count)
      } else {
        onMessageRef.current(msg)
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      wsRef.current = null
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++
        const delay = Math.min(500 * Math.pow(2, retriesRef.current), 8000)
        reconnectTimerRef.current = setTimeout(connect, delay)
      } else {
        setConnectionLost(true)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect()
    return () => {
      retriesRef.current = MAX_RETRIES
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
      }
      wsRef.current?.close()
    }
  }, [connect])

  const navigate = useCallback((slug: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'navigate', roomId: roomIdRef.current, slug }
      wsRef.current.send(JSON.stringify(msg))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    retriesRef.current = 0
    setConnectionLost(false)
    connect()
  }, [connect])

  return { participantCount, navigate, connectionLost, retry }
}
