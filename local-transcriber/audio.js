/**
 * Audio decoding and normalization for Whisper.
 *
 * Whisper expects 16 kHz mono PCM as a Float32Array in the range [-1, 1].
 * Everything here uses only the Web Audio API, so it runs in any browser with
 * no extra dependency.
 */

export const TARGET_SAMPLE_RATE = 16000

export class AudioError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'AudioError'
    if (cause) this.cause = cause
  }
}

/**
 * Decodes any container the browser understands (wav, mp3, m4a, ogg, webm, mp4)
 * into an AudioBuffer.
 */
export async function decodeAudioFile(file, { audioContext } = {}) {
  const bytes = await file.arrayBuffer()

  // Reuse a caller-provided context so repeated decodes are cheaper.
  const context =
    audioContext || new (window.AudioContext || window.webkitAudioContext)()

  try {
    return await context.decodeAudioData(bytes)
  } catch (e) {
    throw new AudioError(
      `Could not decode "${file.name || 'audio'}". Try a wav, mp3, m4a, ogg, webm, or mp4 file.`,
      e
    )
  }
}

/**
 * Number of output frames after resampling.
 *
 * Exported separately from the rendering step so the arithmetic can be tested
 * without a Web Audio implementation.
 */
export function outputFrameCount(audioBuffer) {
  return Math.max(1, Math.floor(audioBuffer.duration * TARGET_SAMPLE_RATE))
}

/** Downmixes to mono and resamples to 16 kHz using OfflineAudioContext. */
export async function toWhisperInput(audioBuffer) {
  const length = outputFrameCount(audioBuffer)

  // OfflineAudioContext resamples during rendering, which avoids the aliasing
  // a naive sample-drop would introduce on downsampled audio.
  const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()

  source.buffer = audioBuffer
  source.connect(offline.destination)
  source.start(0)

  const rendered = await offline.startRendering()
  return normalizeAmplitude(rendered.getChannelData(0))
}

/** Scales samples into [-1, 1] without amplifying pure silence into noise. */
export function normalizeAmplitude(samples, targetPeak = 0.95) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i])
    if (value > peak) peak = value
  }

  if (peak === 0 || peak <= targetPeak) return samples

  const gain = targetPeak / peak
  const scaled = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) scaled[i] = samples[i] * gain

  return scaled
}

/**
 * Removes leading and trailing silence.
 *
 * Meeting recordings are often mostly dead air, and trimming it cuts inference
 * time noticeably. Uses an RMS window rather than a hard threshold so quiet
 * speakers are not clipped out.
 */
export function trimSilence(samples, { sampleRate = TARGET_SAMPLE_RATE, thresholdDb = -42 } = {}) {
  const windowSize = Math.round(sampleRate * 0.02) // 20ms
  const linear = 10 ** (thresholdDb / 20)
  const windows = Math.floor(samples.length / windowSize)

  if (windows < 4) return { samples, didTrim: false }

  const loud = []
  for (let w = 0; w < windows; w++) {
    let sum = 0
    const start = w * windowSize
    for (let i = 0; i < windowSize; i++) {
      const value = samples[start + i]
      sum += value * value
    }
    const rms = Math.sqrt(sum / windowSize)
    if (rms > linear) loud.push(w)
  }

  if (!loud.length) return { samples, didTrim: false }

  const first = loud[0]
  const last = loud[loud.length - 1]

  // Keep a small cushion so word onsets and tails are not clipped.
  const pad = Math.round(sampleRate * 0.15)
  const from = Math.max(0, first * windowSize - pad)
  const to = Math.min(samples.length, (last + 1) * windowSize + pad)

  if (from === 0 && to >= samples.length) return { samples, didTrim: false }

  return { samples: samples.slice(from, to), didTrim: true }
}

/** Splits long audio into overlapping windows, mirroring Whisper's own chunking. */
export function chunkAudio(samples, { chunkSeconds = 30, overlapSeconds = 5, sampleRate = TARGET_SAMPLE_RATE }) {
  const chunkSize = chunkSeconds * sampleRate
  const stride = (chunkSeconds - overlapSeconds) * sampleRate
  const chunks = []

  if (samples.length <= chunkSize) return [{ samples, offsetSeconds: 0 }]

  for (let start = 0; start < samples.length; start += stride) {
    const slice = samples.subarray(start, Math.min(start + chunkSize, samples.length))
    if (!slice.length) break

    chunks.push({ samples: slice, offsetSeconds: start / sampleRate })

    // Stop once a window reaches the end of the audio.
    if (start + chunkSize >= samples.length) break
  }

  return chunks
}

export function audioDurationSeconds(samples, sampleRate = TARGET_SAMPLE_RATE) {
  return samples.length / sampleRate
}

/** True when the samples are effectively silent, to skip wasted inference. */
export function isSilent(samples, threshold = 1e-4) {
  let sum = 0
  const step = Math.max(1, Math.floor(samples.length / 10000))
  let count = 0

  for (let i = 0; i < samples.length; i += step) {
    sum += Math.abs(samples[i])
    count++
  }

  return count === 0 || sum / count < threshold
}