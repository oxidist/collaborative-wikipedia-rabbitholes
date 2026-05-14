# Voice Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in WebRTC peer-to-peer voice chat to Wikihole rooms, with mute toggle and speaking indicators, using the existing WebSocket server as the signaling channel.

**Architecture:** The existing WS server gets a `broadcastOthers` helper that relays four new voice signaling message types (offer/answer/ICE/state) to all room members except the sender. On the client, a `VoiceChatSession` class manages the `RTCPeerConnection` lifecycle; a thin `useVoiceChat` hook wraps it in React state; `RoomBar` gains inline voice controls that appear only when `participantCount > 1`.

**Tech Stack:** WebRTC (`RTCPeerConnection`, `getUserMedia`), Web Audio API (`AnalyserNode` for speaking detection), `stun:stun.l.google.com:19302` (free STUN, no credentials), vitest for tests.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/types/src/index.ts` | Add `IceCandidateInit` + 4 client→server + 4 server→client voice message types |
| Modify | `apps/ws/src/server.ts` | Add `broadcastOthers`; handle 4 voice message types |
| Modify | `apps/ws/src/__tests__/server.test.ts` | Test signaling relay (reaches others, not sender) |
| Create | `apps/web/lib/voiceChatSession.ts` | `VoiceChatSession` class: RTCPeerConnection lifecycle, ICE queuing, speaking detection |
| Create | `apps/web/__tests__/voiceChatSession.test.ts` | Unit tests for `VoiceChatSession` |
| Create | `apps/web/hooks/useVoiceChat.ts` | React hook: wraps session, tracks pending offer, exposes state + `handleSignal` |
| Modify | `apps/web/hooks/useRoom.ts` | Expose `sendSignal` in return value |
| Modify | `apps/web/components/RoomBar.tsx` | Add voice props + inline voice controls |
| Modify | `apps/web/app/globals.css` | Add CSS for voice control elements |
| Modify | `apps/web/app/room/[id]/page.tsx` | Wire `useVoiceChat` to `useRoom` and `RoomBar` |

---

## Task 1: Extend shared types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
// packages/types/src/index.ts

// Matches the browser's RTCIceCandidateInit (defined here to avoid DOM lib dependency)
export interface IceCandidateInit {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

// Client → Server
export type ClientMessage =
  | { type: "join"; roomId: string; articleSlug?: string }
  | { type: "navigate"; roomId: string; slug: string }
  | { type: "voice-offer"; roomId: string; sdp: string }
  | { type: "voice-answer"; roomId: string; sdp: string }
  | { type: "voice-ice"; roomId: string; candidate: IceCandidateInit }
  | { type: "voice-state"; roomId: string; muted: boolean }

// Server → Client
export type ServerMessage =
  | { type: "sync"; slug: string; trail: string[] }
  | { type: "navigate"; slug: string }
  | { type: "participants"; count: number }
  | { type: "voice-offer"; sdp: string }
  | { type: "voice-answer"; sdp: string }
  | { type: "voice-ice"; candidate: IceCandidateInit }
  | { type: "voice-state"; muted: boolean }
```

- [ ] **Step 2: Run type-check across all workspaces**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add voice signaling message types"
```

---

## Task 2: WS server — signaling relay

**Files:**
- Modify: `apps/ws/src/server.ts`
- Modify: `apps/ws/src/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `describe('createServer', ...)` block in `apps/ws/src/__tests__/server.test.ts`:

```typescript
it('relays voice-offer to other room members but not the sender', async () => {
  await startServer()
  const ws1 = await connect()
  const ws2 = await connect()
  const ws3 = await connect()

  // ws1 creates the room
  const sync1 = nextMessage(ws1)
  ws1.send(JSON.stringify({ type: 'join', roomId: 'rv1', articleSlug: 'A' }))
  await sync1

  // ws2 joins
  await new Promise<void>((resolve) => {
    ws2.once('message', () => resolve())
    ws2.send(JSON.stringify({ type: 'join', roomId: 'rv1' }))
  })

  // ws3 joins
  await new Promise<void>((resolve) => {
    ws3.once('message', () => resolve())
    ws3.send(JSON.stringify({ type: 'join', roomId: 'rv1' }))
  })

  // Track everything ws1 receives after this point
  const ws1Received: unknown[] = []
  ws1.on('message', (data) => ws1Received.push(JSON.parse(data.toString())))

  // ws2 and ws3 wait for voice-offer
  const ws2VoiceOffer = new Promise<unknown>((resolve) => {
    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'voice-offer') resolve(msg)
    })
  })
  const ws3VoiceOffer = new Promise<unknown>((resolve) => {
    ws3.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'voice-offer') resolve(msg)
    })
  })

  // ws1 sends voice-offer
  ws1.send(JSON.stringify({ type: 'voice-offer', roomId: 'rv1', sdp: 'test-sdp' }))

  const [msg2, msg3] = await Promise.all([ws2VoiceOffer, ws3VoiceOffer])
  expect(msg2).toMatchObject({ type: 'voice-offer', sdp: 'test-sdp' })
  expect(msg3).toMatchObject({ type: 'voice-offer', sdp: 'test-sdp' })

  // Sender (ws1) must NOT receive its own voice-offer back
  await new Promise((r) => setTimeout(r, 100))
  expect(ws1Received.some((m) => (m as { type: string }).type === 'voice-offer')).toBe(false)

  await closeWs(ws1)
  await closeWs(ws2)
  await closeWs(ws3)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w apps/ws
```

Expected: FAIL — `voice-offer` case not handled.

- [ ] **Step 3: Implement `broadcastOthers` and the four voice message handlers in `apps/ws/src/server.ts`**

Add `broadcastOthers` directly after the existing `broadcast` function (around line 21), and add four new cases inside the `ws.on('message', ...)` handler after the `navigate` branch:

```typescript
// Add after the broadcast() function:
function broadcastOthers(roomId: string, sender: WebSocket, msg: ServerMessage): void {
  const members = rooms.get(roomId)
  if (!members) return
  for (const client of members) {
    if (client !== sender) send(client, msg)
  }
}
```

```typescript
// Add inside the async message handler, after the navigate branch:
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
```

- [ ] **Step 4: Run tests**

```bash
npm test -w apps/ws
```

Expected: all tests pass.

- [ ] **Step 5: Run lint and type-check**

```bash
npm run lint -w apps/ws && npm run type-check -w apps/ws
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/ws/src/server.ts apps/ws/src/__tests__/server.test.ts
git commit -m "feat(ws): relay voice signaling messages to other room members"
```

---

## Task 3: `VoiceChatSession` — core WebRTC class

**Files:**
- Create: `apps/web/lib/voiceChatSession.ts`
- Create: `apps/web/__tests__/voiceChatSession.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/__tests__/voiceChatSession.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientMessage } from '@wikihole/types'
import { VoiceChatSession } from '../lib/voiceChatSession'

// ─── Mocks ──────────────────────────────────────────────────────────────────

class MockAnalyserNode {
  frequencyBinCount = 256
  getByteTimeDomainData = vi.fn((buf: Uint8Array) => buf.fill(128)) // silence
}

class MockAudioContext {
  state = 'running'
  createAnalyser = vi.fn(() => new MockAnalyserNode())
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
  close = vi.fn().mockResolvedValue(undefined)
}

class MockPeerConnection {
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = 'new'
  onicecandidate: ((e: { candidate: { toJSON: () => object } | null }) => void) | null = null
  ontrack: ((e: { track: object }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  addTrack = vi.fn()
  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' })
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' })
  setLocalDescription = vi.fn().mockImplementation(async (desc: { type: string; sdp: string }) => {
    this.localDescription = desc
  })
  setRemoteDescription = vi.fn().mockImplementation(async (desc: { type: string; sdp: string }) => {
    this.remoteDescription = desc
  })
  addIceCandidate = vi.fn().mockResolvedValue(undefined)
  close = vi.fn()
}

const mockTrack = { stop: vi.fn(), enabled: true } as unknown as MediaStreamTrack
const mockStream = {
  getTracks: () => [mockTrack],
  getAudioTracks: () => [mockTrack],
} as unknown as MediaStream

// ─── Setup ──────────────────────────────────────────────────────────────────

let mockPc: MockPeerConnection

beforeEach(() => {
  mockTrack.enabled = true
  ;(mockTrack.stop as ReturnType<typeof vi.fn>).mockReset()
  mockPc = new MockPeerConnection()

  vi.stubGlobal('RTCPeerConnection', vi.fn(() => mockPc))
  vi.stubGlobal('AudioContext', MockAudioContext)
  vi.stubGlobal('requestAnimationFrame', vi.fn()) // no-op; speaking detection not tested
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VoiceChatSession', () => {
  it('join() — gets user media, creates peer connection, sends voice-offer', async () => {
    const signals: ClientMessage[] = []
    const session = new VoiceChatSession('room1', (msg) => signals.push(msg), vi.fn())

    await session.join()

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(RTCPeerConnection).toHaveBeenCalledWith({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    expect(mockPc.createOffer).toHaveBeenCalled()
    expect(mockPc.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'mock-offer-sdp' })
    expect(signals).toContainEqual({ type: 'voice-offer', roomId: 'room1', sdp: 'mock-offer-sdp' })
  })

  it('join() — sets joined:true in state', async () => {
    const states: { joined: boolean }[] = []
    const session = new VoiceChatSession('room1', vi.fn(), (s) => states.push(s))

    await session.join()

    expect(states.at(-1)?.joined).toBe(true)
  })

  it('join() — sets permissionDenied:true when getUserMedia rejects', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      },
    })
    const states: { permissionDenied: boolean }[] = []
    const session = new VoiceChatSession('room1', vi.fn(), (s) => states.push(s))

    await session.join()

    expect(states.at(-1)?.permissionDenied).toBe(true)
    expect(RTCPeerConnection).not.toHaveBeenCalled()
  })

  it('handleOffer() — sets remote desc, sends voice-answer', async () => {
    const signals: ClientMessage[] = []
    const session = new VoiceChatSession('room1', (msg) => signals.push(msg), vi.fn())

    await session.handleOffer('remote-offer-sdp')

    expect(mockPc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote-offer-sdp' })
    expect(mockPc.createAnswer).toHaveBeenCalled()
    expect(mockPc.setLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'mock-answer-sdp' })
    expect(signals).toContainEqual({ type: 'voice-answer', roomId: 'room1', sdp: 'mock-answer-sdp' })
  })

  it('handleAnswer() — sets remote description on the peer connection', async () => {
    const session = new VoiceChatSession('room1', vi.fn(), vi.fn())
    await session.join()

    await session.handleAnswer('remote-answer-sdp')

    expect(mockPc.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'remote-answer-sdp' })
  })

  it('handleIce() before handleAnswer() — queues candidate, drains after remote desc set', async () => {
    const session = new VoiceChatSession('room1', vi.fn(), vi.fn())
    await session.join() // creates PC, sends offer (no remote desc set yet)

    await session.handleIce({ candidate: 'cand1', sdpMid: '0', sdpMLineIndex: 0 })
    expect(mockPc.addIceCandidate).not.toHaveBeenCalled()

    await session.handleAnswer('remote-answer-sdp') // sets remote desc → drains queue
    expect(mockPc.addIceCandidate).toHaveBeenCalledWith({ candidate: 'cand1', sdpMid: '0', sdpMLineIndex: 0 })
  })

  it('handleIce() after remote desc set — adds candidate immediately', async () => {
    const session = new VoiceChatSession('room1', vi.fn(), vi.fn())
    await session.join()
    await session.handleAnswer('remote-answer-sdp')

    await session.handleIce({ candidate: 'cand2', sdpMid: '0', sdpMLineIndex: 0 })
    expect(mockPc.addIceCandidate).toHaveBeenCalledWith({ candidate: 'cand2', sdpMid: '0', sdpMLineIndex: 0 })
  })

  it('toggleMute() — disables local tracks and sends voice-state muted:true', async () => {
    const signals: ClientMessage[] = []
    const session = new VoiceChatSession('room1', (msg) => signals.push(msg), vi.fn())
    await session.join()

    session.toggleMute()

    expect(mockTrack.enabled).toBe(false)
    expect(signals).toContainEqual({ type: 'voice-state', roomId: 'room1', muted: true })
  })

  it('toggleMute() twice — re-enables local tracks and sends voice-state muted:false', async () => {
    const signals: ClientMessage[] = []
    const session = new VoiceChatSession('room1', (msg) => signals.push(msg), vi.fn())
    await session.join()

    session.toggleMute()
    session.toggleMute()

    expect(mockTrack.enabled).toBe(true)
    const lastVoiceState = [...signals].reverse().find((m) => m.type === 'voice-state')
    expect(lastVoiceState).toMatchObject({ type: 'voice-state', muted: false })
  })

  it('leave() — closes peer connection, stops all tracks, emits joined:false', async () => {
    const states: { joined: boolean }[] = []
    const session = new VoiceChatSession('room1', vi.fn(), (s) => states.push(s))
    await session.join()

    session.leave()

    expect(mockPc.close).toHaveBeenCalled()
    expect(mockTrack.stop).toHaveBeenCalled()
    expect(states.at(-1)?.joined).toBe(false)
  })

  it('leave() before join() — is a no-op', () => {
    const session = new VoiceChatSession('room1', vi.fn(), vi.fn())
    expect(() => session.leave()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w apps/web 2>&1 | head -30
```

Expected: FAIL — `../lib/voiceChatSession` not found.

- [ ] **Step 3: Implement `VoiceChatSession`**

Create `apps/web/lib/voiceChatSession.ts`:

```typescript
import type { ClientMessage, IceCandidateInit } from '@wikihole/types'

export interface VoiceState {
  joined: boolean
  muted: boolean
  speaking: boolean
  remoteSpeaking: boolean
  permissionDenied: boolean
}

const STUN_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const SPEAKING_THRESHOLD = 0.01

export class VoiceChatSession {
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private localAnalyser: AnalyserNode | null = null
  private remoteAnalyser: AnalyserNode | null = null
  private animFrameId: number | null = null
  private pendingCandidates: IceCandidateInit[] = []
  private remoteDescSet = false
  private state: VoiceState = {
    joined: false, muted: false, speaking: false, remoteSpeaking: false, permissionDenied: false,
  }

  constructor(
    private readonly roomId: string,
    private readonly sendSignal: (msg: ClientMessage) => void,
    private readonly onStateChange: (state: VoiceState) => void,
  ) {}

  private emit(partial: Partial<VoiceState>): void {
    this.state = { ...this.state, ...partial }
    this.onStateChange({ ...this.state })
  }

  private buildPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection(STUN_CONFIG)
    this.pc = pc

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({
          type: 'voice-ice',
          roomId: this.roomId,
          candidate: e.candidate.toJSON() as IceCandidateInit,
        })
      }
    }

    pc.ontrack = (e) => {
      if (this.audioCtx) {
        const source = this.audioCtx.createMediaStreamSource(new MediaStream([e.track]))
        this.remoteAnalyser = this.audioCtx.createAnalyser()
        source.connect(this.remoteAnalyser)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.leave()
    }

    return pc
  }

  private attachAudio(stream: MediaStream): void {
    this.audioCtx = new AudioContext()
    const source = this.audioCtx.createMediaStreamSource(stream)
    this.localAnalyser = this.audioCtx.createAnalyser()
    source.connect(this.localAnalyser)
    this.startSpeakingDetection()
  }

  private startSpeakingDetection(): void {
    const poll = () => {
      if (!this.localAnalyser) return
      const buf = new Uint8Array(this.localAnalyser.frequencyBinCount)
      this.localAnalyser.getByteTimeDomainData(buf)
      const rms = Math.sqrt(buf.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / buf.length)
      const speaking = rms > SPEAKING_THRESHOLD

      if (this.remoteAnalyser) {
        this.remoteAnalyser.getByteTimeDomainData(buf)
        const rRms = Math.sqrt(buf.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / buf.length)
        this.emit({ speaking, remoteSpeaking: rRms > SPEAKING_THRESHOLD })
      } else {
        this.emit({ speaking })
      }

      this.animFrameId = requestAnimationFrame(poll)
    }
    this.animFrameId = requestAnimationFrame(poll)
  }

  private async drainCandidates(): Promise<void> {
    for (const c of this.pendingCandidates) {
      await this.pc!.addIceCandidate(c as RTCIceCandidateInit)
    }
    this.pendingCandidates = []
  }

  // Initiator path: user clicked "Join voice" before receiving any offer
  async join(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      this.emit({ permissionDenied: true })
      return
    }

    const pc = this.buildPc()
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!))
    this.attachAudio(this.localStream)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.sendSignal({ type: 'voice-offer', roomId: this.roomId, sdp: offer.sdp! })

    this.emit({ joined: true, permissionDenied: false })
  }

  // Responder path: an offer arrived, user then clicked "Join voice" (or was already joined)
  async handleOffer(sdp: string): Promise<void> {
    if (!this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        this.emit({ permissionDenied: true })
        return
      }
    }

    const pc = this.buildPc()
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!))

    await pc.setRemoteDescription({ type: 'offer', sdp })
    this.remoteDescSet = true
    await this.drainCandidates()

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.sendSignal({ type: 'voice-answer', roomId: this.roomId, sdp: answer.sdp! })

    if (!this.audioCtx) this.attachAudio(this.localStream)
    this.emit({ joined: true, permissionDenied: false })
  }

  async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc) return
    await this.pc.setRemoteDescription({ type: 'answer', sdp })
    this.remoteDescSet = true
    await this.drainCandidates()
  }

  async handleIce(candidate: IceCandidateInit): Promise<void> {
    if (!this.pc) return
    if (!this.remoteDescSet) {
      this.pendingCandidates.push(candidate)
      return
    }
    await this.pc.addIceCandidate(candidate as RTCIceCandidateInit)
  }

  toggleMute(): void {
    if (!this.localStream) return
    const muted = !this.state.muted
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = !muted })
    this.sendSignal({ type: 'voice-state', roomId: this.roomId, muted })
    this.emit({ muted })
  }

  leave(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
    this.audioCtx?.close()
    this.audioCtx = null
    this.localAnalyser = null
    this.remoteAnalyser = null
    this.pc?.close()
    this.pc = null
    this.pendingCandidates = []
    this.remoteDescSet = false
    this.emit({ joined: false, muted: false, speaking: false, remoteSpeaking: false })
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -w apps/web
```

Expected: all `VoiceChatSession` tests pass.

- [ ] **Step 5: Run lint and type-check**

```bash
npm run lint -w apps/web && npm run type-check -w apps/web
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/voiceChatSession.ts apps/web/__tests__/voiceChatSession.test.ts
git commit -m "feat(web): VoiceChatSession — WebRTC lifecycle, ICE queuing, speaking detection"
```

---

## Task 4: `useVoiceChat` hook

**Files:**
- Create: `apps/web/hooks/useVoiceChat.ts`

- [ ] **Step 1: Create the hook**

```typescript
// apps/web/hooks/useVoiceChat.ts
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
```

- [ ] **Step 2: Run type-check**

```bash
npm run type-check -w apps/web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/hooks/useVoiceChat.ts
git commit -m "feat(web): useVoiceChat hook — React wrapper over VoiceChatSession"
```

---

## Task 5: Extend `useRoom` to expose `sendSignal`

**Files:**
- Modify: `apps/web/hooks/useRoom.ts`

- [ ] **Step 1: Add `sendSignal` to the return interface and implementation**

In `apps/web/hooks/useRoom.ts`:

1. Add `sendSignal: (msg: ClientMessage) => void` to the `UseRoomReturn` interface (line 16):

```typescript
interface UseRoomReturn {
  participantCount: number
  trail: string[]
  navigate: (slug: string) => void
  sendSignal: (msg: ClientMessage) => void
  connectionLost: boolean
  retry: () => void
}
```

2. Add the `sendSignal` implementation after the existing `navigate` callback (around line 128):

```typescript
const sendSignal = useCallback((msg: ClientMessage) => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify(msg))
  }
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

3. Add `sendSignal` to the return statement (last line of the function):

```typescript
return { participantCount, trail, navigate, sendSignal, connectionLost, retry }
```

- [ ] **Step 2: Run type-check**

```bash
npm run type-check -w apps/web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/hooks/useRoom.ts
git commit -m "feat(web): expose sendSignal from useRoom for voice signaling"
```

---

## Task 6: `RoomBar` — inline voice controls

**Files:**
- Modify: `apps/web/components/RoomBar.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Replace `RoomBar.tsx` contents**

```typescript
// apps/web/components/RoomBar.tsx
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
```

- [ ] **Step 2: Add voice CSS to `apps/web/app/globals.css`**

Append the following after the `.room-bar__copy:focus-visible` rule (around line 137):

```css
/* Voice chat controls */
.room-bar__voice-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.room-bar__voice-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
  transition: background 0.15s;
}

.room-bar__voice-dot--active {
  background: #22c55e;
}

.room-bar__voice-btn {
  background: none;
  border: 1px solid #d0d0d0;
  cursor: pointer;
  color: #555;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 0.8rem;
  white-space: nowrap;
}

.room-bar__voice-btn:hover {
  background: #f5f5f5;
}

.room-bar__voice-leave {
  background: none;
  border: 1px solid #fca5a5;
  cursor: pointer;
  color: #ef4444;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 0.8rem;
  white-space: nowrap;
}

.room-bar__voice-leave:hover {
  background: #fef2f2;
}

.room-bar__voice-join {
  background: none;
  border: 1px solid #d0d0d0;
  cursor: pointer;
  color: #555;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 0.8rem;
  white-space: nowrap;
}

.room-bar__voice-join:hover {
  background: #f5f5f5;
}

.room-bar__voice-denied {
  font-size: 0.8rem;
  color: #ef4444;
}
```

- [ ] **Step 3: Run type-check and lint**

```bash
npm run type-check -w apps/web && npm run lint -w apps/web
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/RoomBar.tsx apps/web/app/globals.css
git commit -m "feat(web): RoomBar voice controls — join, mute, leave, speaking indicators"
```

---

## Task 7: Wire `RoomPage`

**Files:**
- Modify: `apps/web/app/room/[id]/page.tsx`

- [ ] **Step 1: Update `RoomContent` to import and wire `useVoiceChat`**

Replace the `RoomContent` function in `apps/web/app/room/[id]/page.tsx`:

```typescript
'use client'

import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { ServerMessage } from '@wikihole/types'
import { ArticleView } from '@/components/ArticleView'
import { RoomBar } from '@/components/RoomBar'
import { NavigationTrail } from '@/components/NavigationTrail'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { useRoom } from '@/hooks/useRoom'
import { useVoiceChat } from '@/hooks/useVoiceChat'

interface ArticleData {
  html: string
  title: string
  slug: string
}

async function fetchArticle(slug: string): Promise<ArticleData> {
  const res = await fetch(`/api/wikipedia/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`)
  return res.json() as Promise<ArticleData>
}

function RoomContent() {
  const { id: roomId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const initialSlug = searchParams.get('article') ?? ''

  const [article, setArticle] = useState<ArticleData | null>(null)
  const [articleError, setArticleError] = useState(false)
  const [history, setHistory] = useState<ArticleData[]>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  const articleRef = useRef<ArticleData | null>(null)
  const loadingSlugRef = useRef<string | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    }
  }, [])

  const loadArticle = useCallback(async (slug: string) => {
    if (!slug) return
    loadingSlugRef.current = slug
    setArticleError(false)
    setIsTransitioning(true)
    try {
      const data = await fetchArticle(slug)
      const prev = articleRef.current
      if (prev && prev.slug !== slug) {
        setHistory((h) => [...h, prev])
      }
      articleRef.current = data
      setArticle(data)
    } catch {
      setArticleError(true)
    } finally {
      loadingSlugRef.current = null
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = setTimeout(() => setIsTransitioning(false), 200)
    }
  }, [])

  const { participantCount, trail, navigate, sendSignal, connectionLost, retry } = useRoom({
    roomId,
    initialSlug,
    onMessage: handleServerMessage,
  })

  const voice = useVoiceChat({ roomId, sendSignal })

  // Stable ref so handleServerMessage can call handleSignal without being recreated
  const voiceHandleSignalRef = useRef(voice.handleSignal)
  voiceHandleSignalRef.current = voice.handleSignal

  function handleServerMessage(msg: ServerMessage) {
    if (msg.type === 'sync' || msg.type === 'navigate') {
      if (msg.slug !== loadingSlugRef.current) {
        loadArticle(msg.slug)
      }
    } else if (
      msg.type === 'voice-offer' ||
      msg.type === 'voice-answer' ||
      msg.type === 'voice-ice' ||
      msg.type === 'voice-state'
    ) {
      voiceHandleSignalRef.current(msg)
    }
  }

  const handleWikiLinkClick = useCallback((slug: string) => {
    navigate(slug)
    loadArticle(slug)
  }, [navigate, loadArticle])

  const handleBack = useCallback(() => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    articleRef.current = prev
    setArticle(prev)
    navigate(prev.slug)
  }, [history, navigate])

  return (
    <>
      {connectionLost && <ConnectionBanner onRetry={retry} />}
      {article && (
        <RoomBar
          title={article.title}
          participantCount={participantCount}
          canGoBack={history.length > 0}
          onBack={handleBack}
          voiceJoined={voice.joined}
          voiceMuted={voice.muted}
          voiceSpeaking={voice.speaking}
          voiceRemoteSpeaking={voice.remoteSpeaking}
          voicePermissionDenied={voice.permissionDenied}
          onJoinVoice={() => { void voice.join() }}
          onLeaveVoice={voice.leave}
          onToggleMute={voice.toggleMute}
        />
      )}
      {article && trail.length > 0 && (
        <NavigationTrail trail={trail} currentSlug={article.slug} onNavigate={handleWikiLinkClick} />
      )}
      {articleError ? (
        <div className="article-error" role="alert">
          <p>Couldn&apos;t load this article.</p>
          {history.length > 0 && (
            <button onClick={handleBack}>Go back</button>
          )}
        </div>
      ) : article ? (
        <ArticleView
          html={article.html}
          onWikiLinkClick={handleWikiLinkClick}
          isTransitioning={isTransitioning}
        />
      ) : isTransitioning || initialSlug ? (
        <p className="article-loading" aria-live="polite">Loading…</p>
      ) : (
        <p className="article-waiting" aria-live="polite">Waiting for host…</p>
      )}
    </>
  )
}

export default function RoomPage() {
  return (
    <Suspense fallback={<p className="article-loading" aria-live="polite">Loading…</p>}>
      <RoomContent />
    </Suspense>
  )
}
```

> **Note:** `handleServerMessage` is declared as a plain function (not `useCallback`) because it closes over `voice.handleSignal` via `voiceHandleSignalRef` — the ref keeps it stable, and making it a plain function avoids a circular dependency between `useRoom` (which needs `onMessage`) and `useVoiceChat` (which needs `sendSignal` from `useRoom`).

- [ ] **Step 2: Run type-check and lint**

```bash
npm run type-check -w apps/web && npm run lint -w apps/web
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/room/[id]/page.tsx
git commit -m "feat(web): wire voice chat into RoomPage"
```

---

## Self-Review Checklist (for implementer)

Before opening a PR, verify:

- [ ] `npm test` passes across all workspaces
- [ ] `npm run type-check` passes across all workspaces
- [ ] `npm run lint` passes across all workspaces
- [ ] Manual smoke test: open two browser tabs in the same room, click "Join voice" in both, verify audio works
- [ ] Mic permission denied: deny mic access, verify "Mic access denied" message appears for 2s
- [ ] Mute/unmute: verify speaking dots respond and mute button label toggles
- [ ] Leave: verify controls return to "Join voice" state
- [ ] Solo room (1 participant): verify voice controls are hidden entirely
