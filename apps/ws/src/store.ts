export interface Room {
  slug: string
  trail: string[]
}

export interface RoomStore {
  get(roomId: string): Promise<Room | undefined>
  // Atomic: set the current slug and update the trail. Consecutive duplicates
  // are suppressed; if slug matches the entry just before the last (a one-step
  // back navigation), the last entry is popped so A→B→A collapses to [A].
  // Creates the room if it doesn't exist, seeding trail with [slug].
  setSlug(roomId: string, slug: string): Promise<void>
  delete(roomId: string): Promise<void>
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>()

  async get(roomId: string): Promise<Room | undefined> {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    return { slug: room.slug, trail: [...room.trail] }
  }

  async setSlug(roomId: string, slug: string): Promise<void> {
    const existing = this.rooms.get(roomId)
    if (!existing) {
      this.rooms.set(roomId, { slug, trail: [slug] })
      return
    }
    existing.slug = slug
    const trail = existing.trail
    const last = trail[trail.length - 1]
    const prev = trail[trail.length - 2]
    if (last === slug) {
      // consecutive duplicate — no change
    } else if (prev === slug) {
      trail.pop()
    } else {
      trail.push(slug)
    }
  }

  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId)
  }
}
