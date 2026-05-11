export function parseWikiSlug(input: string): string | null {
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    if (!url.hostname.endsWith('wikipedia.org')) return null
    const match = url.pathname.match(/^\/wiki\/(.+)$/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    // Not a URL — treat as bare slug if it looks like one (no slashes)
    if (trimmed.length > 0 && !trimmed.includes('/') && !trimmed.includes(' ')) {
      return trimmed
    }
    return null
  }
}
