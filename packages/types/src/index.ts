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
  | { type: "sync"; slug: string; trail: string[] } // sent on join — current slug + full trail
  | { type: "navigate"; slug: string }      // broadcasted when any participant navigates
  | { type: "participants"; count: number } // broadcasted on join/leave
  | { type: "voice-offer"; sdp: string }
  | { type: "voice-answer"; sdp: string }
  | { type: "voice-ice"; candidate: IceCandidateInit }
  | { type: "voice-state"; muted: boolean }
