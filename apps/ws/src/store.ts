export interface Room {
  slug: string
  trail: string[]
}

export interface RoomStore {
  get(roomId: string): Promise<Room | undefined>
  // Atomic: set the current slug and append to trail (consecutive-dedup).
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
    if (existing.trail[existing.trail.length - 1] !== slug) {
      existing.trail.push(slug)
    }
  }

  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId)
  }
}
