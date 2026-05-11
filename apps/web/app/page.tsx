'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'

function parseWikiSlug(input: string): string | null {
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

export default function HomePage() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const slug = parseWikiSlug(value)
    if (!slug) {
      setError('Enter a Wikipedia URL, e.g. https://en.wikipedia.org/wiki/Octopus')
      return
    }
    const roomId = nanoid(8)
    router.push(`/room/${roomId}?article=${encodeURIComponent(slug)}`)
  }

  return (
    <main className="home">
      <h1>Wikihole</h1>
      <p>Browse Wikipedia together.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="wiki-url">Wikipedia article URL</label>
        <input
          id="wiki-url"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
          placeholder="https://en.wikipedia.org/wiki/Octopus"
          autoFocus
          autoComplete="off"
        />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit">Start session</button>
      </form>
    </main>
  )
}
