import { WebSocketServer, WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@wikihole/types'
import type { RoomStore } from './store.js'
import { MemoryRoomStore } from './store.js'

// roomId → Set of open WebSocket connections
const rooms = new Map<string, Set<WebSocket>>()

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function broadcast(roomId: string, msg: ServerMessage): void {
  const members = rooms.get(roomId)
  if (!members) return
  for (const client of members) {
    send(client, msg)
  }
}

function broadcastOthers(roomId: string, sender: WebSocket, msg: ServerMessage): void {
  const members = rooms.get(roomId)
  if (!members) return
  for (const client of members) {
    if (client !== sender) send(client, msg)
  }
}

function broadcastParticipantCount(roomId: string): void {
  const members = rooms.get(roomId)
  const count = members?.size ?? 0
  broadcast(roomId, { type: 'participants', count })
}

export function createServer(port: number, store: RoomStore = new MemoryRoomStore()): WebSocketServer {
  const wss = new WebSocketServer({ port, host: '0.0.0.0' })
  const deletionTimers = new Map<string, ReturnType<typeof setTimeout>>()

  wss.on('connection', (ws) => {
    let currentRoomId: string | null = null

    ws.on('message', (data) => {
      void (async () => {
        let msg: ClientMessage
        try {
          msg = JSON.parse(data.toString()) as ClientMessage
        } catch {
          return
        }

        if (msg.type === 'join') {
          currentRoomId = msg.roomId

          if (!rooms.has(msg.roomId)) {
            rooms.set(msg.roomId, new Set())
          }
          rooms.get(msg.roomId)!.add(ws)

          const pendingTimer = deletionTimers.get(msg.roomId)
          if (pendingTimer !== undefined) {
            clearTimeout(pendingTimer)
            deletionTimers.delete(msg.roomId)
          }

          let existing = await store.get(msg.roomId)

          if (existing === undefined && msg.articleSlug) {
            await store.setSlug(msg.roomId, msg.articleSlug)
            existing = await store.get(msg.roomId)
          }

          // Guard: client may have disconnected during the await
          if (ws.readyState !== WebSocket.OPEN) return

          if (existing !== undefined) {
            send(ws, { type: 'sync', slug: existing.slug, trail: existing.trail })
          }

          broadcastParticipantCount(msg.roomId)
        } else if (msg.type === 'navigate') {
          // Only allow navigating in the room this client joined
          if (!currentRoomId || msg.roomId !== currentRoomId) return
          await store.setSlug(currentRoomId, msg.slug)
          broadcast(currentRoomId, { type: 'navigate', slug: msg.slug })
        } else if (msg.type === 'voice-offer') {
          if (!currentRoomId || msg.roomId !== currentRoomId) return
          broadcastOthers(currentRoomId, ws, { type: 'voice-offer', sdp: msg.sdp })
        } else if (msg.type === 'voice-answer') {
          if (!currentRoomId || msg.roomId !== currentRoomId) return
          broadcastOthers(currentRoomId, ws, { type: 'voice-answer', sdp: msg.sdp })
        } else if (msg.type === 'voice-ice') {
          if (!currentRoomId || msg.roomId !== currentRoomId) return
          broadcastOthers(currentRoomId, ws, { type: 'voice-ice', candidate: msg.candidate })
        } else if (msg.type === 'voice-state') {
          if (!currentRoomId || msg.roomId !== currentRoomId) return
          broadcastOthers(currentRoomId, ws, { type: 'voice-state', muted: msg.muted })
        }
      })().catch((err) => {
        console.error('[ws] message handler error:', err)
      })
    })

    ws.on('close', () => {
      void (async () => {
        if (!currentRoomId) return
        const members = rooms.get(currentRoomId)
        if (!members) return
        members.delete(ws)
        if (members.size === 0) {
          const roomId = currentRoomId
          const timer = setTimeout(() => {
            rooms.delete(roomId)
            void store.delete(roomId)
            deletionTimers.delete(roomId)
          }, 30_000)
          deletionTimers.set(roomId, timer)
        } else {
          broadcastParticipantCount(currentRoomId)
        }
      })().catch((err) => {
        console.error('[ws] close handler error:', err)
      })
    })

    ws.on('error', () => {
      ws.close()
    })
  })

  return wss
}
