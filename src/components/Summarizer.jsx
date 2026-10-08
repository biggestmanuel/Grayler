import React, { useCallback, useEffect, useRef, useState } from 'react'
import AudioPanel from './AudioPanel'
import ResultView from './ResultView'
import HistoryPanel from './HistoryPanel'
import { getHealth, postSummarize, postTranscribe } from '../lib/api'
import { clearHistory, deleteEntry, loadHistory, newId, saveEntry } from '../lib/history'

const STYLES = [
  { value: 'executive', label: 'Executive brief' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'bullet', label: 'Bullet points' },
]

const SAMPLE = `Weekly sync — March 3
Sarah: the migration to the new billing service slipped again. The Postgres 15 upgrade is blocking the cutover.
Tom: we agreed to push the launch to April 12.
Decision: we will go with a staged rollout, starting with 5 percent of traffic.
Priya: action item, Tom will write the rollback runbook by Friday.
Action item: Sarah to file the vendor contract redlines before the next review.
We also agreed to stop shipping features until the billing work is stable.
Open question is whether we need a second on-call rotation for weekends.
It is still unclear whether the vendor will cover the overage costs.
Dave: error rate is down to 0.2 percent since Tuesday.`

export default function Summarizer() {
  const [tab, setTab] = useState('text')
  const [text, setText] = useState('')
  const [style, setStyle] = useState('executive')
  const [result, setResult] = useState(null)
  const [resultMeta, setResultMeta] = useState({ createdAt: null, sourceLabel: '' })
  const [error, setError] = useState('')
  const [phase, setPhase] = useState(null)
  const [health, setHealth] = useState(null)
  const [history, setHistory] = useState(() => loadHistory())
  const [savedId, setSavedId] = useState(null)

  const abortRef = useRef(null)
  const textRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then(setHealth)
      .catch(() => setHealth(null))
    return () => controller.abort()
  }, [])

  const busy = phase !== null

  const run = useCallback(async (work) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setError('')
    try {
      await work(controller.signal)
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Something went wrong.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setPhase(null)
      }
    }
  }, [])

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    setResult(null)
    setSavedId(null)

    await run(async (signal) => {
      setPhase('summarizing')
      const data = await postSummarize({ text: trimmed, style }, signal)
      setResult(data)
      setResultMeta({ createdAt: new Date().toISOString(), sourceLabel: resultMeta.sourceLabel })
    })
  }

  function cancel() {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase(null)
  }

  async function handleTranscribe(payload) {
    setTab('text')

    await run(async (signal) => {
      setPhase('transcribing')
      const data = await postTranscribe(payload, signal)
      setText((current) => (current.trim() ? `${current.trim()}\n\n${data.text}` : data.text))
      setResultMeta((meta) => ({ ...meta, sourceLabel: payload.filename || 'Recording' }))
      setResult(null)
      setSavedId(null)
    })
  }

  function clearAll() {
    cancel()
    setText('')
    setResult(null)
    setResultMeta({ createdAt: null, sourceLabel: '' })
    setSavedId(null)
    setError('')
  }

  function handleSave() {
    if (!result) return

    saveEntry({
      id: newId(),
      createdAt: resultMeta.createdAt || new Date().toISOString(),
      sourceLabel: resultMeta.sourceLabel || 'Pasted notes',
      style,
      result,
    })

    setHistory(loadHistory())
    setSavedId('saved')
  }

  function restore(entry) {
    setResult(entry.result)
    setStyle(entry.style || 'executive')
    setResultMeta({ createdAt: entry.createdAt, sourceLabel: entry.sourceLabel })
    setSavedId(entry.id)
    setTab('text')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onTextChange(value) {
    setText(value)
    if (resultMeta.sourceLabel && !resultMeta.sourceLabel.startsWith('Pasted')) {
      setResultMeta((meta) => ({ ...meta, sourceLabel: 'Pasted notes' }))
    }
  }

  const tooLong = text.length > 60000

  return (
    <div className="summarizer">
      <div className="tabs" role="tablist" aria-label="Input source">
        <button
          role="tab"
          aria-selected={tab === 'text'}
          className={tab === 'text' ? 'tab is-active' : 'tab'}
          onClick={() => setTab('text')}
        >
          Paste notes
        </button>
        <button
          role="tab"
          aria-selected={tab === 'audio'}
          className={tab === 'audio' ? 'tab is-active' : 'tab'}
          onClick={() => setTab('audio')}
          disabled={!health?.mode}
        >
          Audio
        </button>
      </div>

      <div className="panel">
        {tab === 'text' ? (
          <>
            <label className="visually-hidden" htmlFor="meeting-text">
              Meeting notes or transcript
            </label>
            <textarea
              id="meeting-text"
              ref={textRef}
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Paste meeting notes, a transcript, or copied PDF text here…"
              rows={12}
              aria-invalid={tooLong}
            />
          </>
        ) : (
          <AudioPanel
            onTranscribed={handleTranscribe}
            transcribing={phase === 'transcribing'}
            disabled={busy}
            apiConfigured={health?.mode === 'groq'}
          />
        )}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="controls">
          <div className="control-meta">
            <span className={tooLong ? 'char-count is-over' : 'char-count'}>
              {text.length.toLocaleString()} characters
              {tooLong ? ' — over the 60,000 limit' : ''}
            </span>

            <label className="style-select">
              <span className="visually-hidden">Summary style</span>
              <select value={style} onChange={(e) => setStyle(e.target.value)} disabled={busy}>
                {STYLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="control-buttons">
            <button className="btn-secondary" onClick={clearAll} disabled={busy || (!text && !result)}>
              Clear
            </button>
            {busy ? (
              <button className="btn-secondary" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button className="btn-primary" onClick={submit} disabled={!text.trim() || tooLong}>
                Summarize
              </button>
            )}
          </div>
        </div>

        <p className="keyboard-hint">Tip: press Ctrl/⌘ + Enter to summarize.</p>
      </div>

      {phase === 'summarizing' && (
        <div className="loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Reading the notes…
        </div>
      )}

      {result && (
        <ResultView
          result={result}
          sourceLabel={resultMeta.sourceLabel}
          createdAt={resultMeta.createdAt}
          saved={Boolean(savedId)}
          onSave={handleSave}
        />
      )}

      {!text && !result && (
        <button
          className="sample-link"
          onClick={() => {
            setTab('text')
            setText(SAMPLE)
            setResultMeta({ createdAt: null, sourceLabel: 'Sample notes' })
            textRef.current?.focus()
          }}
        >
          Try it with sample notes
        </button>
      )}

      <HistoryPanel
        entries={history}
        onRestore={restore}
        onDelete={(id) => {
          deleteEntry(id)
          setHistory(loadHistory())
          if (savedId === id) setSavedId(null)
        }}
        onClear={() => {
          clearHistory()
          setHistory([])
          setSavedId(null)
        }}
      />
    </div>
  )
}