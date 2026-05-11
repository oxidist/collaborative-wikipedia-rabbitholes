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

  const [participantCount, setParticipantCount] = useState(1)
  const [connectionLost, setConnectionLost] = useState(false)

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      retriesRef.current = 0
      setConnectionLost(false)
      const msg: ClientMessage = { type: 'join', roomId, articleSlug: initialSlug || undefined }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (event: MessageEvent) => {
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
      wsRef.current = null
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++
        const delay = Math.min(500 * Math.pow(2, retriesRef.current), 8000)
        setTimeout(connect, delay)
      } else {
        setConnectionLost(true)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [roomId, initialSlug]) // initialSlug intentionally stable after mount

  useEffect(() => {
    connect()
    return () => {
      // Prevent reconnect on unmount
      retriesRef.current = MAX_RETRIES
      wsRef.current?.close()
    }
  }, [connect])

  const navigate = useCallback((slug: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'navigate', roomId, slug }
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [roomId])

  const retry = useCallback(() => {
    retriesRef.current = 0
    setConnectionLost(false)
    connect()
  }, [connect])

  return { participantCount, navigate, connectionLost, retry }
}
