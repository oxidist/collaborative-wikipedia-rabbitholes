import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { createServer } from '../server.js'

const TEST_PORT = 18765

describe('createServer', () => {
  let wss: ReturnType<typeof createServer>

  afterEach(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  })

  async function startServer(): Promise<void> {
    wss = createServer(TEST_PORT)
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve)
      wss.once('error', reject)
    })
  }

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`)
      ws.once('open', () => resolve(ws))
      ws.once('error', reject)
    })
  }

  function nextMessage(ws: WebSocket): Promise<unknown> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
  }

  function closeWs(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      ws.once('close', () => resolve())
      ws.close()
    })
  }

  it('syncs new joining client with the slug they provided', async () => {
    await startServer()
    const ws = await connect()
    const msgPromise = nextMessage(ws)
    ws.send(JSON.stringify({ type: 'join', roomId: 'r1', articleSlug: 'Octopus' }))
    const msg = await msgPromise
    expect(msg).toMatchObject({ type: 'sync', slug: 'Octopus' })
    await closeWs(ws)
  })

  it('syncs late joiner to current room slug', async () => {
    await startServer()
    const ws1 = await connect()
    // ws1 creates room
    const firstSync = nextMessage(ws1)
    ws1.send(JSON.stringify({ type: 'join', roomId: 'r2', articleSlug: 'Octopus' }))
    await firstSync

    const ws2 = await connect()
    // Skip participants message from ws1, get sync from ws2
    const ws2Messages: unknown[] = []
    ws2.on('message', (data) => ws2Messages.push(JSON.parse(data.toString())))
    ws2.send(JSON.stringify({ type: 'join', roomId: 'r2' }))

    // Wait for ws2 to receive messages
    await new Promise((resolve) => setTimeout(resolve, 100))

    const sync = ws2Messages.find((m) => (m as { type: string }).type === 'sync')
    expect(sync).toMatchObject({ type: 'sync', slug: 'Octopus' })

    await closeWs(ws1)
    await closeWs(ws2)
  })

  it('broadcasts navigate to all room members', async () => {
    await startServer()
    const ws1 = await connect()
    const ws2 = await connect()

    // Both join room r3
    const join1 = nextMessage(ws1)
    ws1.send(JSON.stringify({ type: 'join', roomId: 'r3', articleSlug: 'Octopus' }))
    await join1

    const join2Done = new Promise<void>((resolve) => {
      let count = 0
      ws2.on('message', () => { count++; if (count >= 1) resolve() })
    })
    ws2.send(JSON.stringify({ type: 'join', roomId: 'r3' }))
    await join2Done

    // ws1 navigates
    const ws2NavPromise = new Promise<unknown>((resolve) => {
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'navigate') resolve(msg)
      })
    })
    ws1.send(JSON.stringify({ type: 'navigate', roomId: 'r3', slug: 'Cephalopod' }))
    const nav = await ws2NavPromise
    expect(nav).toMatchObject({ type: 'navigate', slug: 'Cephalopod' })

    await closeWs(ws1)
    await closeWs(ws2)
  })

  it('does not allow navigating to a different room than joined', async () => {
    await startServer()
    const ws1 = await connect()
    const ws2 = await connect()

    // ws1 joins r4
    const sync1 = nextMessage(ws1)
    ws1.send(JSON.stringify({ type: 'join', roomId: 'r4', articleSlug: 'Octopus' }))
    await sync1

    // ws2 joins r5
    const sync2 = nextMessage(ws2)
    ws2.send(JSON.stringify({ type: 'join', roomId: 'r5', articleSlug: 'Squid' }))
    await sync2

    // ws1 tries to navigate r5 (room it didn't join) — should be a no-op
    const ws2ReceivedNav = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 200)
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'navigate') { clearTimeout(timer); resolve(true) }
      })
    })
    ws1.send(JSON.stringify({ type: 'navigate', roomId: 'r5', slug: 'Cephalopod' }))
    const received = await ws2ReceivedNav
    expect(received).toBe(false)

    await closeWs(ws1)
    await closeWs(ws2)
  })
})
