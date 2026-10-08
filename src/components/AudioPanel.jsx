import React, { useRef, useState } from 'react'
import {
  ACCEPTED_AUDIO,
  blobToFile,
  fileToBase64,
  formatBytes,
  formatDuration,
  isRecordingSupported,
  startRecording,
} from '../lib/audio'

const MAX_LOCAL_BYTES = 8 * 1024 * 1024

export default function AudioPanel({ onTranscribed, transcribing, disabled, apiConfigured }) {
  const [file, setFile] = useState(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const recorderRef = useRef(null)

  function reset() {
    setFile(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleTranscribe(target = file) {
    if (!target) return
    setError('')

    try {
      const data = await fileToBase64(target)
      await onTranscribed({
        data,
        filename: target.name || 'audio.webm',
        mimeType: target.type || '',
      })
    } catch (e) {
      setError(e.message || 'Could not read that file.')
    }
  }

  function selectFile(next) {
    if (!next) return

    if (next.size > MAX_LOCAL_BYTES) {
      setError(`That file is ${formatBytes(next.size)}. Keep it under ${formatBytes(MAX_LOCAL_BYTES)}.`)
      return
    }

    setError('')
    setFile(next)
    handleTranscribe(next)
  }

  async function toggleRecording() {
    if (recording) {
      await recorderRef.current?.stop()
      recorderRef.current = null
      setRecording(false)
      return
    }

    setError('')
    try {
      const session = await startRecording(setElapsed)
      recorderRef.current = session
      setRecording(true)
    } catch (e) {
      setError(
        e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
          : 'Could not start recording.'
      )
    }
  }

  async function stopAndTranscribe() {
    const session = recorderRef.current
    if (!session) return

    const blob = await session.stop()
    recorderRef.current = null
    setRecording(false)
    setElapsed(0)

    const recorded = blobToFile(blob, 'recording')
    if (!recorded.size) {
      setError('Nothing was recorded.')
      return
    }
    setFile(recorded)
    await handleTranscribe(recorded)
  }

  const busy = transcribing || recording

  return (
    <div className="audio-panel">
      {!apiConfigured && (
        <p className="hint hint-warn">
          Transcription needs <code>GROQ_API_KEY</code> on the server. Add it to <code>.env</code> and
          restart to enable this tab.
        </p>
      )}

      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) selectFile(e.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_AUDIO}
          className="visually-hidden"
          disabled={disabled}
          onChange={(e) => selectFile(e.target.files?.[0])}
        />

        <p className="dropzone-title">Drop a recording here</p>
        <p className="dropzone-sub">
          mp3, m4a, wav, ogg, webm, mp4 or flac — up to {formatBytes(MAX_LOCAL_BYTES)}
        </p>

        <div className="dropzone-actions">
          <button
            className="btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy || disabled}
          >
            Choose file
          </button>

          {isRecordingSupported() && (
            <button
              className={recording ? 'btn-danger' : 'btn-secondary'}
              onClick={recording ? stopAndTranscribe : toggleRecording}
              disabled={transcribing || disabled}
            >
              {recording ? `Stop · ${formatDuration(elapsed)}` : 'Record'}
            </button>
          )}
        </div>

        {file && !recording && (
          <p className="dropzone-file">
            {file.name} · {formatBytes(file.size)}
          </p>
        )}
        {recording && <p className="dropzone-recording">Recording… {formatDuration(elapsed)}</p>}
      </div>

      {error && <p className="audio-error">{error}</p>}

      {transcribing && <p className="audio-status">Transcribing with Whisper…</p>}

      {file && !busy && !transcribing && (
        <button className="btn-secondary btn-small" onClick={reset}>
          Clear audio
        </button>
      )}
    </div>
  )
}