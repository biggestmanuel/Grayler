/**
 * Worker-backed transcriber. Kept separate from index.js so the entry point
 * stays a plain export surface that can be copied without dragging in the
 * worker construction order.
 */

import { DEVICES, DTYPES, DEFAULT_MODEL_ID, detectCapabilities, resolveDevice } from './models.js'
import {
  decodeAudioFile,
  toWhisperInput,
  trimSilence,
  isSilent,
  audioDurationSeconds,
  TARGET_SAMPLE_RATE,
  AudioError,
} from './audio.js'

let requestCounter = 0

/**
 * Wraps a worker and exposes a promise-based API.
 *
 * @param {object} [options]
 * @param {string} [options.modelId]
 * @param {'auto'|'webgpu'|'wasm'} [options.device]
 * @param {(progress: object) => void} [options.onProgress]
 * @param {Worker} [options.worker] Inject a worker, mainly for tests.
 * @param {number} [options.sampleRate]
 */
export async function createTranscriber(options = {}) {
  const capabilities = options.capabilities || (await detectCapabilities())
  const requestedDevice = options.device || DEVICES.AUTO
  const device = resolveDevice(requestedDevice, capabilities)

  if (!device) {
    throw new Error(capabilities.webgpuReason || 'WebGPU was requested but is not available.')
  }

  const modelId = options.modelId || DEFAULT_MODEL_ID
  const dtype = options.dtype || DTYPES[device]
  const sampleRate = options.sampleRate || TARGET_SAMPLE_RATE

  const worker =
    options.worker || new Worker(new URL('./transcribe.worker.js', import.meta.url), { type: 'module' })

  const pending = new Map()

  worker.addEventListener('message', (event) => {
    const message = event.data
    if (!message) return

    // Progress without an id belongs to model loading, which has no request.
    if (message.type === 'progress' && message.id == null) {
      options.onProgress?.(message)
      return
    }

    const entry = pending.get(message.id)
    if (!entry) return

    if (message.type === 'progress') {
      options.onProgress?.(message)
      return
    }

    pending.delete(message.id)

    if (message.type === 'result') {
      entry.resolve(message)
    } else if (message.type === 'cancelled') {
      const error = new Error('Transcription cancelled.')
      error.name = 'AbortError'
      entry.reject(error)
    } else if (message.type === 'error') {
      entry.reject(new Error(message.message))
    }
  })

  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The transcription worker crashed.')
    for (const [, entry] of pending) entry.reject(error)
    pending.clear()
  })

  // Warm the model so the first transcription is not slowed by loading.
  await new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = event.data
      if (message?.type === 'ready') {
        worker.removeEventListener('message', onMessage)
        resolve()
      } else if (message?.type === 'error') {
        worker.removeEventListener('message', onMessage)
        reject(new Error(message.message))
      }
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage({ type: 'load', modelId, device, dtype })
  })

  return {
    modelId,
    device,
    dtype,
    capabilities,
    sampleRate,

    /**
     * Decodes, normalizes, and transcribes a File or Blob.
     *
     * @param {File|Blob} file
     * @param {object} [transcribeOptions]
     * @param {string|null} [transcribeOptions.language] ISO-639-1, or null to detect
     * @param {'transcribe'|'translate'} [transcribeOptions.task]
     * @param {boolean|'word'} [transcribeOptions.timestamps]
     * @param {boolean} [transcribeOptions.trimSilence]
     * @returns {Promise<{text: string, chunks: Array, language: string, durationSeconds: number, device: string}>}
     */
    async transcribe(file, transcribeOptions = {}) {
      if (!file) throw new Error('No file provided.')

      const audioBuffer = await decodeAudioFile(file)
      let samples = await toWhisperInput(audioBuffer)

      if (transcribeOptions.trimSilence !== false) {
        samples = trimSilence(samples, { sampleRate }).samples
      }

      if (isSilent(samples)) {
        throw new AudioError('No speech was detected in that audio.')
      }

      const id = ++requestCounter

      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })

      worker.postMessage(
        {
          type: 'transcribe',
          id,
          samples,
          options: {
            modelId,
            device,
            dtype,
            sampleRate,
            language: transcribeOptions.language ?? null,
            task: transcribeOptions.task || 'transcribe',
            timestamps: transcribeOptions.timestamps ?? true,
            chunking: transcribeOptions.chunking,
          },
        },
        // Transfer the buffer so the audio is not copied across threads.
        [samples.buffer]
      )

      return promise
    },

    /** Requests cancellation of every in-flight transcription. */
    cancel() {
      for (const id of pending.keys()) worker.postMessage({ type: 'cancel', id })
    },

    /** Terminates the worker and releases the model. */
    dispose() {
      for (const [, entry] of pending) {
        const error = new Error('Transcriber disposed.')
        error.name = 'AbortError'
        entry.reject(error)
      }
      pending.clear()
      worker.terminate()
    },

    /** Seconds of audio in a Float32Array, for progress display. */
    audioDurationSeconds(samples) {
      return audioDurationSeconds(samples, sampleRate)
    },
  }
}