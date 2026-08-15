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
