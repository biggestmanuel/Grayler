import React, { useRef, useState } from 'react'
import { useLocalTranscriber } from '../../local-transcriber/react.js'
import { MODELS, LANGUAGES, formatBytes } from '../../local-transcriber/models.js'
import { renderTranscriptToMarkdown } from '../../local-transcriber/format.js'
import { ACCEPTED_AUDIO, formatDuration } from '../lib/audio'
import { copyText, downloadFile } from '../lib/export'

/**
 * On-device transcription via Whisper in the browser.
 *
 * Runs in parallel with the Groq path; nothing here touches the server, so
 * audio stays on the machine. Falls back to the server path when the model
 * cannot load.
 */
export default function LocalTranscribePanel({ onTranscribed, disabled, onUseServer }) {
  const { state, progress, result, error, capabilities, transcribe, cancel, reset } =
    useLocalTranscriber()

  const [file, setFile] = useState(null)
  const [modelId, setModelId] = useState('onnx-community/whisper-base')
  const [language, setLanguage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const inputRef = useRef(null)

  const busy = state === 'transcribing' || state === 'decoding'
  const model = MODELS.find((entry) => entry.id === modelId)

  function accept(next) {
    if (!next) return
    setFile(next)
    reset()
    setSeconds(0)
  }

  async function run() {
    if (!file) return
    setSeconds(0)

    // A rough duration estimate from file size, good enough to warn the user.
    const approx = file.size / 32000
    setSeconds(approx)

    const outcome = await transcribe(file, {
      language: language || null,
      task: 'transcribe',
      timestamps: true,
    })

    if (outcome) onTranscribed?.({ text: outcome.text, filename: file.name })
  }

  async function handleCopy() {
    if (!result) return
    await copyText(renderTranscriptToMarkdown(result))
  }

  return (
    <div className="local-panel">
      <p className="hint hint-local">
        Runs Whisper on this device through your browser&apos;s GPU. The audio is never uploaded and
        no API key is used. The first run downloads the model (~{formatBytes(model?.approxBytes)}) and
        caches it.
      </p>

      {!capabilities?.webgpu && capabilities && (
        <p className="hint hint-warn">
          WebGPU unavailable, so this will run on CPU and be slower.
        </p>
      )}

      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) accept(e.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_AUDIO}
          className="visually-hidden"
          disabled={disabled}
          onChange={(e) => accept(e.target.files?.[0])}
        />

        <p className="dropzone-title">Drop audio to transcribe locally</p>
        <p className="dropzone-sub">wav, mp3, m4a, ogg, webm, mp4 or flac</p>

        <div className="dropzone-actions">
          <button
            className="btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy || disabled}
          >
            Choose file
          </button>
          {file && (
            <button className="btn-primary" onClick={run} disabled={busy || disabled}>
              {busy ? 'Working…' : 'Transcribe'}
            </button>
          )}
          {busy && (
            <button className="btn-secondary" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>

        {file && (
          <p className="dropzone-file">
            {file.name} · {formatBytes(file.size)}
            {seconds > 0 && !busy ? ` · ~${formatDuration(Math.round(seconds))} audio` : ''}
          </p>
        )}
      </div>

      <div className="local-controls">
        <label className="style-select">
          <span className="visually-hidden">Model</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={busy}>
            {MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} · {formatBytes(entry.approxBytes)}
              </option>
            ))}
          </select>
        </label>

        <label className="style-select">
          <span className="visually-hidden">Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {LANGUAGES.map((entry) => (
              <option key={entry.code || 'auto'} value={entry.code || ''}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        {onUseServer && (
          <button className="btn-secondary btn-small" onClick={onUseServer} disabled={busy}>
            Use server instead
          </button>
        )}
      </div>

      {state === 'loading-model' && (
        <div className="local-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {progress.status === 'download' && progress.total
            ? `Downloading ${progress.file?.split('/').pop()} · ${Math.round(progress.progress)}%`
            : 'Loading model…'}
        </div>
      )}

      {busy && progress.status === 'transcribe' && (
        <div className="local-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Transcribing
          {progress.totalChunks ? ` · window ${progress.chunk}/${progress.totalChunks}` : ''}
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
          {error.includes('key') === false && onUseServer && (
            <>
              {' '}
              <button className="link-button" onClick={onUseServer}>
                Use the server instead
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="local-result">
          <div className="result-header">
            <div className="result-meta">
              <span className="badge badge-local">
                {result.device === 'webgpu' ? 'On device · WebGPU' : 'On device · CPU'}
              </span>
              {result.durationSeconds && (
                <span className="result-time">{formatDuration(Math.round(result.durationSeconds))}</span>
              )}
            </div>
            <div className="result-actions">
              <button className="btn-secondary btn-small" onClick={handleCopy}>
                Copy
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={() =>
                  downloadFile('grayler-transcript.md', renderTranscriptToMarkdown(result))
                }
              >
                Download .md
              </button>
            </div>
          </div>
          <p className="local-transcript">{result.text}</p>
        </div>
      )}
    </div>
  )
}