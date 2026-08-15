import React, { useEffect, useState } from 'react'
import Summarizer from './components/Summarizer'

function getInitialTheme() {
  const saved = localStorage.getItem('grayler-theme')
  if (saved) return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function Logo() {
  return (
    <svg className="logo-mark" width="40" height="40" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--chrome-1)" />
          <stop offset="100%" stopColor="var(--chrome-2)" />
        </linearGradient>
      </defs>
      <circle
        cx="50" cy="50" r="32"
        fill="none"
        stroke="url(#chrome)"
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray="150 201"
        transform="rotate(-72 50 50)"
      />
      <polygon points="80,44 96,52 80,60" fill="url(#chrome)" />
      <rect x="50" y="46" width="26" height="11" rx="2" fill="url(#chrome)" />
      <g transform="translate(18,60)">
        <rect x="0" y="0" width="34" height="24" rx="8" fill="var(--accent)" />
        <polygon points="6,24 6,32 14,24" fill="var(--accent)" />
        <rect x="7" y="7" width="18" height="3" rx="1.5" fill="var(--chrome-1)" />
        <rect x="7" y="13" width="20" height="3" rx="1.5" fill="rgba(255,255,255,0.6)" />
        <rect x="7" y="19" width="14" height="3" rx="1.5" fill="rgba(255,255,255,0.6)" />
      </g>
    </svg>
  )
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('grayler-theme', theme)
  }, [theme])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div className="brand-text">
            <h1>Grayler</h1>
            <p>Paste notes, get the summary, action items, and decisions.</p>
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </header>
      <main>
        <Summarizer />
      </main>
    </div>
  )
}
