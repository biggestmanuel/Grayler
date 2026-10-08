import React, { useState } from 'react'
import { downloadFile, timestampedFilename } from '../lib/export'
import { resultToMarkdown } from '../lib/markdown'

function summarizeForList(result) {
  return result.summary || result.action_items?.[0] || result.decisions?.[0] || 'No summary text'
}

export default function HistoryPanel({ entries, onRestore, onDelete, onClear }) {
  const [confirming, setConfirming] = useState(false)

  if (!entries.length) return null

  function exportAll() {
    const markdown = entries
      .map((entry) =>
        resultToMarkdown(entry.result, {
          sourceLabel: entry.sourceLabel,
          createdAt: entry.createdAt,
        })
      )
      .join('\n\n---\n\n')

    downloadFile(timestampedFilename('grayler-history'), markdown)
  }

  return (
    <section className="history">
      <header className="history-header">
        <h2>
          Saved summaries <span className="count">{entries.length}</span>
        </h2>
        <div className="history-actions">
          <button className="btn-secondary btn-small" onClick={exportAll}>
            Export all
          </button>
          {confirming ? (
            <button
              className="btn-danger btn-small"
              onClick={() => {
                onClear()
                setConfirming(false)
              }}
              onBlur={() => setConfirming(false)}
            >
              Confirm delete
            </button>
          ) : (
            <button className="btn-secondary btn-small" onClick={() => setConfirming(true)}>
              Clear all
            </button>
          )}
        </div>
      </header>

      <p className="hint">Stored in this browser only — nothing is uploaded or kept on a server.</p>

      <ul className="history-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button className="history-entry" onClick={() => onRestore(entry)}>
              <span className="history-title">{summarizeForList(entry.result)}</span>
              <span className="history-meta">
                {new Date(entry.createdAt).toLocaleString()}
                {entry.sourceLabel ? ` · ${entry.sourceLabel}` : ''}
              </span>
            </button>
            <button
              className="history-delete"
              onClick={() => onDelete(entry.id)}
              aria-label={`Delete summary from ${new Date(entry.createdAt).toLocaleString()}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}