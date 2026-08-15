import React, { useState } from 'react'

export default function Summarizer() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  async function submit() {
    if (!text.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      if (!res.ok) throw new Error('Server error')
      const j = await res.json()
      setResult(j)
    } catch (e) {
      setResult({ error: e.message })
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setText('')
    setResult(null)
  }

  return (
    <div className="summarizer">
      <div className="panel">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste meeting notes, transcript, or copied PDF text here…"
          rows={12}
        />
        <div className="controls">
          <span className="char-count">{text.length.toLocaleString()} characters</span>
          <div className="control-buttons">
            <button className="btn-secondary" onClick={clear} disabled={loading && !text}>
              Clear
            </button>
            <button className="btn-primary" onClick={submit} disabled={loading || !text.trim()}>
              {loading ? 'Summarizing…' : 'Summarize'}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="result">
          {result.error && <div className="error">{result.error}</div>}
          {result.summary && (
            <section>
              <h3>Summary</h3>
              <p>{result.summary}</p>
            </section>
          )}
          {result.action_items && result.action_items.length > 0 && (
            <section>
              <h3>Action Items</h3>
              <ul>{result.action_items.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </section>
          )}
          {result.decisions && result.decisions.length > 0 && (
            <section>
              <h3>Decisions</h3>
              <ul>{result.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
