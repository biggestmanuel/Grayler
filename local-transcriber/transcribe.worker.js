/**
 * Worker that owns the Whisper model and does all inference off the main thread.
 *
 * Protocol
 *   in : { type: 'load', modelId, device, dtype }
 *        { type: 'transcribe', id, samples (Float32Array), options }
 *        { type: 'cancel', id }
 *   out: { type: 'ready', device, dtype }
 *        { type: 'progress', id, status, progress, file, loaded, total, message }
 *        { type: 'result', id, text, chunks, language, durationSeconds }
 *        { type: 'error', id, message }
 *        { type: 'cancelled', id }
 */

import { pipeline, env } from '@huggingface/transformers'
import { DTYPES } from './models.js'
import { audioDurationSeconds, chunkAudio } from './audio.js'

// Models are fetched from the Hub and cached in the browser Cache API.
// Disabling local model paths avoids a 404 probe against the page origin.
env.allowLocalModels = false
env.useBrowserCache = true

let transcriber = null
let loadedKey = null
let currentDevice = null

/** Ids cancelled before or during their run. */
const cancelled = new Set()

function post(message, transfer) {
  self.postMessage(message, transfer || [])
}

async function getTranscriber(modelId, device, dtype) {
  const key = `${modelId}|${device}|${JSON.stringify(dtype)}`
  if (transcriber && loadedKey === key) return transcriber

  if (transcriber) {
    await transcriber.dispose().catch(() => {})
    transcriber = null
    loadedKey = null
  }

  transcriber = await pipeline('automatic-speech-recognition', modelId, {
    device,
    dtype,
    progress_callback: (info) => {
      if (info.status === 'progress' && info.total) {
        post({
          type: 'progress',
          status: 'download',
          file: info.file,
          loaded: info.loaded,
          total: info.total,
          progress: info.progress,
        })
      } else if (info.status === 'ready') {
        post({ type: 'progress', status: 'ready' })
      }
    },
  })

  loadedKey = key
  currentDevice = device
  return transcriber
}

async function handleTranscribe(message) {
  const { id, samples, options = {} } = message
  const sampleRate = options.sampleRate || 16000

  const model = await getTranscriber(
    options.modelId,
    options.device,
    options.dtype || DTYPES[options.device] || DTYPES.WASM
  )

  if (cancelled.has(id)) {
    cancelled.delete(id)
    return post({ type: 'cancelled', id })
  }

  const chunks = chunkAudio(samples, { sampleRate, ...options.chunking })
  const durationSeconds = audioDurationSeconds(samples, sampleRate)

  // Whisper only sees 30s of audio at a time, so longer input is windowed.
  // Window offsets are added back so timestamps match the original recording.
  const useWindowing = chunks.length > 1
  const merged = []
  let text = ''

  for (let index = 0; index < chunks.length; index++) {
    if (cancelled.has(id)) {
      cancelled.delete(id)
      return post({ type: 'cancelled', id })
    }

    post({
      type: 'progress',
      id,
      status: 'transcribe',
      chunk: index + 1,
      totalChunks: chunks.length,
      progress: (index / chunks.length) * 100,
    })

    const { samples: window, offsetSeconds } = chunks[index]

    const output = await model(window, {
      return_timestamps: options.timestamps || true,
      // language and task must be omitted rather than null.
      ...(options.language ? { language: options.language } : {}),
      ...(options.task ? { task: options.task } : {}),
      ...(options.initialPrompt ? { ...{} } : {}),
    })

    const chunkText = (output.text || '').trim()
    if (chunkText) text += (text ? ' ' : '') + chunkText

    for (const entry of output.chunks || []) {
      const [start, end] = entry.timestamp || []
      if (start == null) continue
      merged.push({
        text: entry.text,
        // Offset is meaningless when the model already chunked internally.
        start: useWindowing ? Number((start + offsetSeconds).toFixed(2)) : start,
        end: useWindowing && end != null ? Number((end + offsetSeconds).toFixed(2)) : end,
      })
    }
  }

  post({
    type: 'result',
    id,
    text: text.trim(),
    chunks: merged,
    language: options.language || 'auto',
    durationSeconds: Number(durationSeconds.toFixed(2)),
    device: currentDevice,
  })
}

self.addEventListener('message', async (event) => {
  const message = event.data
  if (!message || !message.type) return

  try {
    if (message.type === 'load') {
      post({ type: 'progress', status: 'load' })
      await getTranscriber(message.modelId, message.device, message.dtype)
      return post({ type: 'ready', device: currentDevice })
    }

    if (message.type === 'transcribe') {
      // The buffer is transferred, so hand ownership of the samples over.
      const samples =
        message.samples instanceof Float32Array
          ? message.samples
          : new Float32Array(message.samples)

      await handleTranscribe({ ...message, samples })
      return
    }

    if (message.type === 'cancel') {
      cancelled.add(message.id)
      // Cancellation is checked between windows; a long single window cannot be
      // interrupted mid-decode, so this is best-effort by design.
      return
    }
  } catch (e) {
    post({
      type: 'error',
      id: message.id,
      message: e?.message || 'Transcription failed.',
    })
  }
})