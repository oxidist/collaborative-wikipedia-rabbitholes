'use client'

import { useState, useEffect } from 'react'
import styles from './TableOfContents.module.css'
import type { TocEntry } from '@/lib/processArticle'

interface TableOfContentsProps {
  toc: TocEntry[]
}

export function buildTocNumbers(toc: TocEntry[]): string[] {
  const numbers: string[] = []
  let h2Count = 0
  let h3Count = 0
  for (const entry of toc) {
    if (entry.level === 2) {
      h2Count++
      h3Count = 0
      numbers.push(`${h2Count}.`)
    } else {
      if (h2Count === 0) {
        numbers.push('')
        continue
      }
      h3Count++
      numbers.push(`${h2Count}.${h3Count}`)
    }
  }
  return numbers
}

export function TableOfContents({ toc }: TableOfContentsProps) {
  const [isOpen, setIsOpen] = useState(true)

  useEffect(() => {
    if (window.innerWidth <= 600) setIsOpen(false)
  }, [])

  if (toc.length === 0) return null

  const numbers = buildTocNumbers(toc)

  return (
    <nav className={styles.toc} aria-label="Table of contents">
      <div className={styles.header}>
        <span className={styles.title}>Contents</span>
        <button
          className={styles.toggle}
          onClick={() => setIsOpen(o => !o)}
          aria-expanded={isOpen}
        >
          {isOpen ? '[hide]' : '[show]'}
        </button>
      </div>
      {isOpen && (
        <ol className={styles.list}>
          {toc.map((entry, i) => (
            <li
              key={entry.id}
              className={entry.level === 3 ? styles.subentry : styles.entry}
            >
              <a href={`#${entry.id}`}>{numbers[i]} {entry.text}</a>
            </li>
          ))}
        </ol>
      )}
    </nav>
  )
}
