import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRoomStore } from '../store.js'

describe('MemoryRoomStore', () => {
  let store: MemoryRoomStore

  beforeEach(() => {
    store = new MemoryRoomStore()
  })

  it('returns undefined for an unknown room', () => {
    expect(store.get('nonexistent')).toBeUndefined()
  })

  it('stores and retrieves a slug', () => {
    store.set('room1', 'Octopus')
    expect(store.get('room1')).toBe('Octopus')
  })

  it('overwrites an existing room slug', () => {
    store.set('room1', 'Octopus')
    store.set('room1', 'Cephalopod')
    expect(store.get('room1')).toBe('Cephalopod')
  })

  it('deletes a room', () => {
    store.set('room1', 'Octopus')
    store.delete('room1')
    expect(store.get('room1')).toBeUndefined()
  })

  it('delete on unknown room does not throw', () => {
    expect(() => store.delete('nonexistent')).not.toThrow()
  })

  it('isolates rooms from each other', () => {
    store.set('room1', 'Octopus')
    store.set('room2', 'Squid')
    expect(store.get('room1')).toBe('Octopus')
    expect(store.get('room2')).toBe('Squid')
  })
})
