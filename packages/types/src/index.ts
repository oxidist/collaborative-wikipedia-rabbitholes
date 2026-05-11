// Client → Server
export type ClientMessage =
  | { type: "join"; roomId: string; articleSlug?: string }
  | { type: "navigate"; roomId: string; slug: string }

// Server → Client
export type ServerMessage =
  | { type: "sync"; slug: string }          // sent on join — always, with current slug
  | { type: "navigate"; slug: string }      // broadcasted when any participant navigates
  | { type: "participants"; count: number } // broadcasted on join/leave
