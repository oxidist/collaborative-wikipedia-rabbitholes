# Voice Chat Design

**Date:** 2026-05-15  
**Feature:** Opt-in peer-to-peer voice chat for Wikihole rooms  
**Status:** Approved, ready for implementation

---

## Overview

Add opt-in WebRTC voice chat to Wikihole rooms. Participants click "Join voice" in the RoomBar to enter a call. The existing WebSocket server acts as the signaling channel — no media server or new infrastructure required. Targeting 2–4 participants (usually 2); full peer-to-peer mesh is sufficient at this scale.

---

## Protocol (shared types — `packages/types`)

Five new message types are added to `@wikihole/types`, split between client→server and server→client.

### Client → Server

```ts
| { type: 'voice-offer';  roomId: string; sdp: string }
| { type: 'voice-answer'; roomId: string; sdp: string }
| { type: 'voice-ice';    roomId: string; candidate: RTCIceCandidateInit }
| { type: 'voice-state';  roomId: string; muted: boolean }
```

### Server → Client

```ts
| { type: 'voice-offer';  sdp: string }
| { type: 'voice-answer'; sdp: string }
| { type: 'voice-ice';    candidate: RTCIceCandidateInit }
| { type: 'voice-state';  muted: boolean }
```

The server strips `roomId` and relays to other room members — it never inspects SDP or ICE content. `voice-state` carries mute status so remote peers can update their UI without audio analysis.

---

## WebSocket Server (`apps/ws`)

### New helper

```ts
function broadcastOthers(roomId: string, sender: WebSocket, msg: ServerMessage): void
```

Identical to the existing `broadcast` but skips `sender`. Used exclusively for signaling relay.

### Message handler additions

Four new cases in the existing `ws.on('message', ...)` handler:

```
voice-offer  → broadcastOthers(currentRoomId, ws, { type: 'voice-offer',  sdp })
voice-answer → broadcastOthers(currentRoomId, ws, { type: 'voice-answer', sdp })
voice-ice    → broadcastOthers(currentRoomId, ws, { type: 'voice-ice',    candidate })
voice-state  → broadcastOthers(currentRoomId, ws, { type: 'voice-state',  muted })
```

Each case guards on `currentRoomId` (same as `navigate`). No changes to `RoomStore`, room lifecycle, or existing tests.

---

## Client (`apps/web`)

### `useVoiceChat` hook (`hooks/useVoiceChat.ts`)

Owns the full WebRTC lifecycle. Interface:

```ts
interface UseVoiceChatOptions {
  roomId: string
  sendSignal: (msg: ClientMessage) => void
}

interface UseVoiceChatReturn {
  joined: boolean
  muted: boolean
  speaking: boolean       // local mic is active above threshold
  remoteSpeaking: boolean // remote peer is active above threshold
  permissionDenied: boolean
  join: () => Promise<void>
  leave: () => void
  toggleMute: () => void
  handleSignal: (msg: ServerMessage) => void // caller routes voice-* messages here
}
```

**Internals:**

- STUN: `stun:stun.l.google.com:19302` (free, no credentials)
- **Initiator detection:** whichever peer calls `join()` first creates and sends the offer. If a `voice-offer` arrives before the local peer has sent one, this peer is the responder — it sets remote description and sends an answer.
- **ICE queuing:** candidates that arrive before `setRemoteDescription` completes are queued and drained after.
- **Speaking detection:** Web Audio `AnalyserNode` polls RMS amplitude on `requestAnimationFrame`. Fires when amplitude crosses a fixed threshold (same node works for both local stream and remote `MediaStream` from `ontrack`).
- **Cleanup:** `leave()` closes `RTCPeerConnection`, stops all local `MediaStreamTrack`s, disconnects the `AudioContext`, and resets all state.

### `useRoom` changes (`hooks/useRoom.ts`)

- Adds `sendSignal(msg: ClientMessage): void` — thin wrapper over the existing WS send, exposed in the return value.
- `onMessage` in the room page routes `voice-*` messages to `useVoiceChat`'s `handleSignal`. No structural changes to `useRoom`.

### `RoomBar` changes (`components/RoomBar.tsx`)

New props:

```ts
voiceJoined: boolean
voiceMuted: boolean
voiceSpeaking: boolean
voiceRemoteSpeaking: boolean
voicePermissionDenied: boolean
onJoinVoice: () => void
onLeaveVoice: () => void
onToggleMute: () => void
```

Rendering states (voice controls only shown when `participantCount > 1`):

| State | Controls shown |
|---|---|
| Not joined | `🎙 Join voice` button |
| Permission denied | `Mic access denied` text (2s, then reverts) |
| Joined, unmuted | Speaking indicator · `Mute` button · `Leave` button |
| Joined, muted | Speaking indicator · `Unmute` button · `Leave` button |

Speaking indicators: small filled dot (●) beside a label, green when speaking, dim when silent. One for local, one for remote.

### Room page (`app/room/[id]/page.tsx`)

Wires `useVoiceChat` and `useRoom` together:
- Passes `sendSignal` from `useRoom` into `useVoiceChat`
- Routes incoming `voice-*` messages to `useVoiceChat.handleSignal`
- Passes voice state and callbacks down to `RoomBar`

---

## Error Handling

| Failure | Behaviour |
|---|---|
| `getUserMedia` denied | `permissionDenied: true` → RoomBar shows "Mic access denied" for 2s, resets to idle |
| `RTCPeerConnection` reaches `"failed"` state | `leave()` called internally, resets to idle; user re-joins manually |
| WS drops while in a call | Existing reconnect logic handles WS; voice resets to idle on disconnect (peer connection is dead); user re-joins after WS reconnects |

Voice state is fully ephemeral — nothing persists across page reloads.

---

## Testing

### `apps/ws`
- `broadcastOthers` unit test: signaling messages reach all room members except the sender

### `apps/web`
- `useVoiceChat` with mocked `RTCPeerConnection` and `getUserMedia`:
  - Offer/answer exchange (initiator path + responder path)
  - ICE candidate queuing and drain
  - Mute toggle
  - `leave()` cleanup (tracks stopped, AudioContext closed, peer connection closed)
  - Permission denied path
- `RoomBar` tests for each voice rendering state (idle, joined+unmuted, joined+muted, permission denied)

No E2E audio tests (consistent with existing test philosophy).
