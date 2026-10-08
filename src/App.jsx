import React, { useEffect, useState } from 'react'
import Summarizer from './components/Summarizer'

function getInitialTheme() {
  const saved = localStorage.getItem('grayler-theme')
  if (saved) return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function Logo() {
  return <img className="logo-mark" src="/logo.png" alt="Grayler" width="40" height="40" />
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
            <p>Paste notes or drop a recording, get the summary, action items, and decisions.</p>
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </header>

      <main>
        <Summarizer />
      </main>

      <footer className="footer">
        <p>
          Notes are sent to the server only to produce a summary and are not stored. Saved summaries
          live in this browser.
        </p>
      </footer>
    </div>
  )
}