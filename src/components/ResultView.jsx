import React, { useState } from 'react'
import { copyText, downloadFile, timestampedFilename } from '../lib/export'
import { resultToMarkdown } from '../lib/markdown'

const SECTIONS = [
  { key: 'summary', title: 'Summary', ordered: false },
  { key: 'action_items', title: 'Action items', ordered: false },
  { key: 'decisions', title: 'Decisions', ordered: false },
  { key: 'open_questions', title: 'Open questions', ordered: false },
]

export default function ResultView({ result, sourceLabel, createdAt, onSave, saved }) {
  const [notice, setNotice] = useState('')

  if (!result) return null

  const hasContent = SECTIONS.some((section) => {
    const value = result[section.key]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  })

  function flash(message) {
    setNotice(message)
    setTimeout(() => setNotice(''), 2200)
  }

  async function handleCopy() {
    try {
      await copyText(resultToMarkdown(result, { sourceLabel, createdAt }))
      flash('Copied as Markdown')
    } catch (e) {
      flash(e.message || 'Could not copy')
    }
  }

  function handleDownload() {
    downloadFile(timestampedFilename(), resultToMarkdown(result, { sourceLabel, createdAt }))
    flash('Downloaded')
  }

  return (
    <div className="result">
      <div className="result-header">
        <div className="result-meta">
          {result.mode === 'extractive' && (
            <span className="badge badge-warn" title="No GROQ_API_KEY on the server">
              Offline extractive
            </span>
          )}
          {createdAt && <span className="result-time">{new Date(createdAt).toLocaleString()}</span>}
        </div>

        <div className="result-actions">
          <button className="btn-secondary btn-small" onClick={handleCopy} disabled={!hasContent}>
            Copy
          </button>
          <button className="btn-secondary btn-small" onClick={handleDownload} disabled={!hasContent}>
            Download .md
          </button>
          <button
            className={saved ? 'btn-secondary btn-small' : 'btn-primary btn-small'}
            onClick={onSave}
            disabled={!hasContent || saved}
          >
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {notice && <div className="result-notice">{notice}</div>}

      {!hasContent && <p className="result-empty">The model did not return anything for this text.</p>}

      {SECTIONS.map(({ key, title }) => {
        const value = result[key]
        const items = Array.isArray(value) ? value : value ? [value] : []
        if (!items.length) return null

        return (
          <section key={key}>
            <h3>
              {title}
              {Array.isArray(value) && <span className="count">{items.length}</span>}
            </h3>
            {Array.isArray(value) ? (
              <ul>
                {items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>{value}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}