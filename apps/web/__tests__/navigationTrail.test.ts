import { describe, it, expect } from 'vitest'
import { slugToLabel, buildExportText } from '../components/NavigationTrail'

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

describe('buildExportText', () => {
  it('formats a single entry as a title', () => {
    expect(buildExportText(['Albert_Einstein'])).toBe('Albert Einstein')
  })

  it('formats multiple entries arrow-separated', () => {
    expect(buildExportText(['Albert_Einstein', 'Theory_of_relativity'])).toBe(
      'Albert Einstein → Theory of relativity'
    )
  })

  it('replaces all underscores', () => {
    expect(buildExportText(['Foo_Bar_Baz'])).toBe('Foo Bar Baz')
  })

  it('returns empty string for empty trail', () => {
    expect(buildExportText([])).toBe('')
  })
})
