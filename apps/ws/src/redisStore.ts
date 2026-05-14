import { Redis } from 'ioredis'
import type { Room, RoomStore } from './store.js'

export class RedisRoomStore implements RoomStore {
  private redis: Redis
  private readonly prefix = 'wh:room:'

  constructor(url: string) {
    this.redis = new Redis(url)
  }

  async get(roomId: string): Promise<Room | undefined> {
    const val = await this.redis.get(this.prefix + roomId)
    if (val === null) return undefined
    try {
      const parsed = JSON.parse(val) as Partial<Room> & { slug?: string }
      if (typeof parsed.slug !== 'string') return undefined
      // Backward compat: rooms persisted before trail existed
      const trail = Array.isArray(parsed.trail) ? parsed.trail : [parsed.slug]
      return { slug: parsed.slug, trail }
    } catch {
      // Legacy format: bare slug string
      return { slug: val, trail: [val] }
    }
  }

  async setSlug(roomId: string, slug: string): Promise<void> {
    const key = this.prefix + roomId
    const existing = await this.get(roomId)
    let room: Room
    if (!existing) {
      room = { slug, trail: [slug] }
    } else {
      const trail = existing.trail
      if (trail[trail.length - 1] !== slug) trail.push(slug)
      room = { slug, trail }
    }
    await this.redis.set(key, JSON.stringify(room))
  }

  async delete(roomId: string): Promise<void> {
    await this.redis.del(this.prefix + roomId)
  }
}
