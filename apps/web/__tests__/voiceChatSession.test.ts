import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientMessage } from '@wikihole/types'
import { VoiceChatSession, type VoiceState } from '../lib/voiceChatSession'

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
  signalingState = 'stable'
  onicecandidate: ((e: { candidate: { toJSON: () => object } | null }) => void) | null = null
  ontrack: ((e: { track: object }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  addTrack = vi.fn()
  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' })
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' })
  setLocalDescription = vi.fn().mockImplementation(async (desc: { type: string; sdp: string }) => {
    this.localDescription = desc
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable'
  })
  setRemoteDescription = vi.fn().mockImplementation(async (desc: { type: string; sdp: string }) => {
    this.remoteDescription = desc
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable'
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

  describe('startSpeakingDetection — change-gated emit', () => {
    let rafCallback: FrameRequestCallback | null

    beforeEach(() => {
      rafCallback = null
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb
        return 0
      }))
    })

    it('does not emit on frames where speaking status is unchanged', async () => {
      const states: VoiceState[] = []
      const session = new VoiceChatSession('room1', vi.fn(), (s) => states.push(s))
      await session.join()
      const baseline = states.length

      // Analyser returns silence — speaking stays false across all frames
      rafCallback!(0)
      rafCallback!(0)
      rafCallback!(0)

      expect(states.length).toBe(baseline)
    })

    it('emits once when speaking transitions false→true, not again while still speaking', async () => {
      const localAnalyser = new MockAnalyserNode()
      const audioCtx = new MockAudioContext()
      audioCtx.createAnalyser = vi.fn(() => localAnalyser)
      vi.stubGlobal('AudioContext', vi.fn(() => audioCtx))

      const states: VoiceState[] = []
      const session = new VoiceChatSession('room1', vi.fn(), (s) => states.push(s))
      await session.join()
      const baseline = states.length

      // Switch analyser to loud audio (RMS >> SPEAKING_THRESHOLD)
      localAnalyser.getByteTimeDomainData = vi.fn((buf: Uint8Array) => buf.fill(200))

      rafCallback!(0) // false → true transition → one emit
      expect(states.length).toBe(baseline + 1)
      expect(states.at(-1)?.speaking).toBe(true)

      rafCallback!(0) // still true — no emit
      expect(states.length).toBe(baseline + 1)
    })
  })
})
