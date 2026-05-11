export interface RoomStore {
  get(roomId: string): string | undefined
  set(roomId: string, slug: string): void
  delete(roomId: string): void
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, string>()

  get(roomId: string): string | undefined {
    return this.rooms.get(roomId)
  }

  set(roomId: string, slug: string): void {
    this.rooms.set(roomId, slug)
  }

  delete(roomId: string): void {
    this.rooms.delete(roomId)
  }
}
