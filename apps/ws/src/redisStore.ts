import { Redis } from 'ioredis'
import type { RoomStore } from './store.js'

export class RedisRoomStore implements RoomStore {
  private redis: Redis
  private readonly prefix = 'wh:room:'

  constructor(url: string) {
    this.redis = new Redis(url)
  }

  async get(roomId: string): Promise<string | undefined> {
    const val = await this.redis.get(this.prefix + roomId)
    return val ?? undefined
  }

  async set(roomId: string, slug: string): Promise<void> {
    await this.redis.set(this.prefix + roomId, slug)
  }

  async delete(roomId: string): Promise<void> {
    await this.redis.del(this.prefix + roomId)
  }
}
