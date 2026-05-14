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

  it('seeds trail from the initial slug', async () => {
    await store.setSlug('room1', 'Octopus')
    expect(await store.get('room1')).toEqual({ slug: 'Octopus', trail: ['Octopus'] })
  })

  it('appends new slugs to the trail', async () => {
    await store.setSlug('room1', 'Octopus')
    await store.setSlug('room1', 'Cephalopod')
    expect(await store.get('room1')).toEqual({
      slug: 'Cephalopod',
      trail: ['Octopus', 'Cephalopod'],
    })
  })

  it('suppresses consecutive duplicates', async () => {
    await store.setSlug('room1', 'Octopus')
    await store.setSlug('room1', 'Octopus')
    await store.setSlug('room1', 'Cephalopod')
    await store.setSlug('room1', 'Cephalopod')
    expect((await store.get('room1'))?.trail).toEqual(['Octopus', 'Cephalopod'])
  })

  it('records non-consecutive repeats', async () => {
    await store.setSlug('room1', 'A')
    await store.setSlug('room1', 'B')
    await store.setSlug('room1', 'A')
    expect((await store.get('room1'))?.trail).toEqual(['A', 'B', 'A'])
  })

  it('deletes a room', async () => {
    await store.setSlug('room1', 'Octopus')
    await store.delete('room1')
    expect(await store.get('room1')).toBeUndefined()
  })

  it('delete on unknown room does not throw', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow()
  })

  it('isolates rooms from each other', async () => {
    await store.setSlug('room1', 'Octopus')
    await store.setSlug('room2', 'Squid')
    expect((await store.get('room1'))?.slug).toBe('Octopus')
    expect((await store.get('room2'))?.slug).toBe('Squid')
  })

  it('returned trail is a copy (mutating it does not affect store)', async () => {
    await store.setSlug('room1', 'A')
    const room = await store.get('room1')
    room!.trail.push('B')
    expect((await store.get('room1'))?.trail).toEqual(['A'])
  })
})
