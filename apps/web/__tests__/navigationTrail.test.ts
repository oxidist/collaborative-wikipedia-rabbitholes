import { describe, it, expect } from 'vitest'
import { slugToLabel } from '../components/NavigationTrail'

describe('slugToLabel', () => {
  it('replaces underscores with spaces', () => {
    expect(slugToLabel('Albert_Einstein')).toBe('Albert Einstein')
  })

  it('passes through slugs without underscores', () => {
    expect(slugToLabel('Octopus')).toBe('Octopus')
  })

  it('replaces all underscores', () => {
    expect(slugToLabel('Theory_of_relativity')).toBe('Theory of relativity')
  })

  it('handles empty string', () => {
    expect(slugToLabel('')).toBe('')
  })
})
