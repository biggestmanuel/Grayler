'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = '../local-transcriber'

/* The module under test is ESM, so it is pulled in through a data URL shim
   that resolves its relative imports to absolute file paths. */
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

let mod

test.before(async () => {
  // Node can import the ESM files directly; only the browser-only entry points
  // (worker, react, vanilla) are skipped.
  mod = await import(pathToFileURL(resolve(__dirname, ROOT, 'format.js')).href)
})

test('srt output is numbered and uses comma-separated timestamps', async () => {
  const { renderTranscriptToSrt } = mod
  const srt = renderTranscriptToSrt({
    text: 'Hello there.',
    chunks: [
      { text: ' Hello', start: 0, end: 0.5 },
      { text: ' there.', start: 0.5, end: 1.25 },
    ],
  })

  // Cue text is trimmed, so no leading space leaks into the subtitle file.
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:00,500\nHello/)
  assert.match(srt, /2\n00:00:00,500 --> 00:00:01,250\nthere\./)
  assert.ok(srt.endsWith('\n'))
})

test('srt extends a missing end using the next cue start', async () => {
  const { renderTranscriptToSrt } = mod
  const srt = renderTranscriptToSrt({
    text: 'a b',
    chunks: [
      { text: ' a', start: 1, end: null },
      { text: ' b', start: 3, end: 4 },
    ],
  })

  // The first cue borrows the second cue's start rather than emitting a zero length.
  assert.match(srt, /00:00:01,000 --> 00:00:03,000/)
})

test('vtt output uses the WEBVTT header and dot milliseconds', async () => {
  const { renderTranscriptToVtt } = mod
  const vtt = renderTranscriptToVtt({
    text: 'Hi',
    language: 'en',
    chunks: [{ text: ' Hi', start: 0, end: 0.5 }],
  })

  assert.match(vtt, /^WEBVTT\n/)
  assert.match(vtt, /NOTE Language: en/)
  assert.match(vtt, /00:00:00\.000 --> 00:00:00\.500/)
})

test('formatters still produce valid output without timestamps', async () => {
  const { renderTranscriptToSrt, renderTranscriptToVtt, renderTranscriptToPlainText } = mod
  const result = { text: 'Just text, no cues.' }

  assert.match(renderTranscriptToSrt(result), /1\n00:00:00,000 --> 00:00:00,000/)
  assert.match(renderTranscriptToVtt(result), /^WEBVTT/)
  assert.equal(renderTranscriptToPlainText(result), 'Just text, no cues.')
})

test('empty transcripts produce empty or header-only output', async () => {
  const { renderTranscriptToSrt, renderTranscriptToVtt, renderTranscriptToMarkdown } = mod
  const empty = { text: '', chunks: [] }

  assert.equal(renderTranscriptToSrt(empty), '')
  assert.equal(renderTranscriptToVtt(empty), 'WEBVTT\n\n')
  assert.match(renderTranscriptToMarkdown(empty), /## Text/)
})

test('markdown includes model metadata and timestamped cues', async () => {
  const { renderTranscriptToMarkdown } = mod
  const md = renderTranscriptToMarkdown({
    text: 'Full text',
    model: 'onnx-community/whisper-base',
    device: 'webgpu',
    durationSeconds: 12,
    chunks: [{ text: ' Full text', start: 0, end: 2 }],
  })

  assert.match(md, /^# Transcript/)
  assert.match(md, /Model: onnx-community\/whisper-base/)
  assert.match(md, /Device: webgpu/)
  assert.match(md, /- \*\*00:00:00\*\* Full text/)
})


/* ----------------------------- audio helpers ----------------------------- */

test('chunkAudio leaves short audio as a single window', async () => {
  const { chunkAudio } = await import(pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href)
  const samples = new Float32Array(16000) // one second

  const chunks = chunkAudio(samples, { sampleRate: 16000 })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].offsetSeconds, 0)
})

test('chunkAudio splits long audio with increasing offsets and full coverage', async () => {
  const { chunkAudio } = await import(pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href)
  const samples = new Float32Array(16000 * 100) // 100s

  const chunks = chunkAudio(samples, { sampleRate: 16000, chunkSeconds: 30, overlapSeconds: 5 })

  assert.ok(chunks.length > 1)
  assert.equal(chunks[0].offsetSeconds, 0)
  assert.deepEqual(
    chunks.map((c) => c.offsetSeconds),
    [0, 25, 50, 75]
  )
  // The final window must reach the end of the audio.
  const last = chunks[chunks.length - 1]
  assert.equal(last.offsetSeconds + last.samples.length / 16000, 100)
})

test('trimSilence removes leading and trailing quiet audio', async () => {
  const { trimSilence } = await import(pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href)
  const sampleRate = 16000
  const samples = new Float32Array(sampleRate * 10)

  // Loud tone only in the middle second.
  for (let i = sampleRate * 4; i < sampleRate * 5; i++) samples[i] = 0.5

  const { samples: trimmed, didTrim } = trimSilence(samples, { sampleRate })

  assert.equal(didTrim, true)
  assert.ok(trimmed.length < samples.length)
  assert.ok(trimmed.length > sampleRate) // the tone survives
})

test('trimSilence leaves already-tight audio alone', async () => {
  const { trimSilence } = await import(pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href)
  const samples = new Float32Array(16000 * 5).fill(0.5)

  const { samples: trimmed, didTrim } = trimSilence(samples, { sampleRate: 16000 })
  assert.equal(didTrim, false)
  assert.equal(trimmed.length, samples.length)
})

test('outputFrameCount sizes the resampled buffer from the duration', async () => {
  const { outputFrameCount, TARGET_SAMPLE_RATE } = await import(
    pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href
  )

  // 11s of 44.1kHz audio must become 11s of 16kHz audio, not 11s / (44100/16000).
  const buffer = { duration: 11, sampleRate: 44100 }
  assert.equal(outputFrameCount(buffer), 11 * TARGET_SAMPLE_RATE)
  assert.equal(outputFrameCount({ duration: 11, sampleRate: 16000 }), 176000)
  assert.equal(outputFrameCount({ duration: 0.001, sampleRate: 44100 }), 16)
  assert.ok(outputFrameCount({ duration: 0, sampleRate: 44100 }) >= 1)
})

test('isSilent distinguishes silence from a quiet tone', async () => {
  const { isSilent } = await import(pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href)

  assert.equal(isSilent(new Float32Array(16000)), true)
  assert.equal(isSilent(new Float32Array(16000).fill(0.3)), false)
})

test('normalizeAmplitude scales loud audio down but leaves quiet audio alone', async () => {
  const { normalizeAmplitude } = await import(
    pathToFileURL(resolve(__dirname, ROOT, 'audio.js')).href
  )

  const loud = new Float32Array([1, -1, 0.5])
  const scaled = normalizeAmplitude(loud, 0.95)
  assert.ok(Math.max(...scaled) <= 0.95 + 1e-6)
  assert.ok(Math.min(...scaled) >= -0.95 - 1e-6)

  // Float32 storage means 0.2 is not exactly 0.2, so compare with a tolerance.
  const quiet = new Float32Array([0.2, -0.2])
  const untouched = normalizeAmplitude(quiet, 0.95)
  assert.ok(Math.abs(untouched[0] - 0.2) < 1e-6)
  assert.ok(Math.abs(untouched[1] + 0.2) < 1e-6)
})


/* ------------------------------ model logic ------------------------------ */

test('resolveDevice picks webgpu when available and honours an explicit request', async () => {
  const { resolveDevice, DEVICES } = await import(
    pathToFileURL(resolve(__dirname, ROOT, 'models.js')).href
  )

  assert.equal(resolveDevice('auto', { webgpu: true }), 'webgpu')
  assert.equal(resolveDevice('auto', { webgpu: false }), 'wasm')
  assert.equal(resolveDevice('wasm', { webgpu: true }), 'wasm')

  // An explicit webgpu request fails rather than silently downgrading.
  assert.equal(resolveDevice('webgpu', { webgpu: false }), null)
  assert.equal(DEVICES.WEBGPU, 'webgpu')
})

test('every catalog model has the fields the UI renders', async () => {
  const { MODELS, formatBytes, findModel, DEFAULT_MODEL_ID } = await import(
    pathToFileURL(resolve(__dirname, ROOT, 'models.js')).href
  )

  assert.ok(MODELS.length >= 4)

  for (const model of MODELS) {
    assert.equal(typeof model.id, 'string')
    assert.equal(typeof model.label, 'string')
    assert.ok(model.approxBytes > 0, `${model.id} needs a size`)
    assert.equal(typeof model.note, 'string')
  }

  assert.equal(findModel(DEFAULT_MODEL_ID).id, DEFAULT_MODEL_ID)
  assert.equal(findModel('does/not-exist'), null)
  assert.match(formatBytes(1_500_000), /1\.4 MB/)
})

test('estimateDuration grows with audio length and shrinks with model size', async () => {
  const { estimateDuration } = await import(
    pathToFileURL(resolve(__dirname, ROOT, 'models.js')).href
  )

  const short = estimateDuration({
    audioSeconds: 60,
    modelId: 'onnx-community/whisper-base',
    device: 'webgpu',
  })
  const long = estimateDuration({
    audioSeconds: 3600,
    modelId: 'onnx-community/whisper-base',
    device: 'webgpu',
  })
  const heavy = estimateDuration({
    audioSeconds: 60,
    modelId: 'onnx-community/whisper-large-v3-turbo',
    device: 'webgpu',
  })

  assert.ok(long > short, 'longer audio should take longer')
  assert.ok(heavy > short, 'a bigger model should take longer')
  assert.equal(typeof short, 'number')
})

test('dtype presets keep the whisper encoder at higher precision', async () => {
  const { DTYPES } = await import(pathToFileURL(resolve(__dirname, ROOT, 'models.js')).href)

  // Whisper's encoder is accuracy-sensitive; it must not be q4 on either device.
  assert.notEqual(DTYPES.WEBGPU.encoder_model, 'q4')
  assert.notEqual(DTYPES.WASM.encoder_model, 'q4')
  assert.equal(DTYPES.WEBGPU.decoder_model_merged, 'q4')
})