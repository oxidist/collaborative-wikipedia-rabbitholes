import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wikihole',
  description: 'Browse Wikipedia together.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
