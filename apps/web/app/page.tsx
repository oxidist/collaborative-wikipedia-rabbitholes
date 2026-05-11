'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
import { parseWikiSlug } from '../lib/parseWikiSlug'

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
          aria-describedby="wiki-url-error"
        />
        {error && <p id="wiki-url-error" className="error" role="alert">{error}</p>}
        <button type="submit">Start session</button>
      </form>
    </main>
  )
}
