export interface RoomStore {
  get(roomId: string): Promise<string | undefined>
  set(roomId: string, slug: string): Promise<void>
  delete(roomId: string): Promise<void>
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, string>()

  async get(roomId: string): Promise<string | undefined> {
    return this.rooms.get(roomId)
  }

  async set(roomId: string, slug: string): Promise<void> {
    this.rooms.set(roomId, slug)
  }

  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId)
  }
}
