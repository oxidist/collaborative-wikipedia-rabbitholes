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
