import { WebSocketServer, WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@wikihole/types'
import { MemoryRoomStore } from './store.js'

const store = new MemoryRoomStore()
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

function broadcastParticipantCount(roomId: string): void {
  const members = rooms.get(roomId)
  const count = members?.size ?? 0
  broadcast(roomId, { type: 'participants', count })
}

export function createServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

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

          const existing = await store.get(msg.roomId)
          if (existing !== undefined) {
            // Room exists — sync this client to current state
            send(ws, { type: 'sync', slug: existing })
          } else if (msg.articleSlug) {
            // New room — create with the provided slug and sync back
            await store.set(msg.roomId, msg.articleSlug)
            send(ws, { type: 'sync', slug: msg.articleSlug })
          }

          broadcastParticipantCount(msg.roomId)
        } else if (msg.type === 'navigate') {
          await store.set(msg.roomId, msg.slug)
          broadcast(msg.roomId, { type: 'navigate', slug: msg.slug })
        }
      })()
    })

    ws.on('close', () => {
      void (async () => {
        if (!currentRoomId) return
        const members = rooms.get(currentRoomId)
        if (!members) return
        members.delete(ws)
        if (members.size === 0) {
          rooms.delete(currentRoomId)
          await store.delete(currentRoomId)
        } else {
          broadcastParticipantCount(currentRoomId)
        }
      })()
    })

    ws.on('error', () => {
      ws.close()
    })
  })

  return wss
}
