import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomStore } from '../store.js'
import { MemoryRoomStore } from '../store.js'

describe('MemoryRoomStore', () => {
  let store: RoomStore

  beforeEach(() => {
    store = new MemoryRoomStore()
  })

  it('returns undefined for an unknown room', async () => {
    expect(await store.get('nonexistent')).toBeUndefined()
  })

  it('stores and retrieves a slug', async () => {
    await store.set('room1', 'Octopus')
    expect(await store.get('room1')).toBe('Octopus')
  })

  it('overwrites an existing room slug', async () => {
    await store.set('room1', 'Octopus')
    await store.set('room1', 'Cephalopod')
    expect(await store.get('room1')).toBe('Cephalopod')
  })

  it('deletes a room', async () => {
    await store.set('room1', 'Octopus')
    await store.delete('room1')
    expect(await store.get('room1')).toBeUndefined()
  })

  it('delete on unknown room does not throw', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow()
  })

  it('isolates rooms from each other', async () => {
    await store.set('room1', 'Octopus')
    await store.set('room2', 'Squid')
    expect(await store.get('room1')).toBe('Octopus')
    expect(await store.get('room2')).toBe('Squid')
  })
})
