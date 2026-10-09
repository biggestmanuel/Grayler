/**
 * local-transcriber
 *
 * On-device speech-to-text with Whisper running in the browser through
 * transformers.js. Audio never leaves the machine.
 *
 *   import { createTranscriber } from 'local-transcriber'
 *
 *   const transcriber = await createTranscriber()
 *   const result = await transcriber.transcribe(file)
 *   console.log(result.text)
 *   transcriber.dispose()
 */

export { createTranscriber } from './transcriber.js'

export {
  MODELS,
  LANGUAGES,
  DEVICES,
  DTYPES,
  DEFAULT_MODEL_ID,
  detectCapabilities,
  resolveDevice,
  estimateDuration,
  formatBytes,
  findModel,
} from './models.js'

export {
  decodeAudioFile,
  toWhisperInput,
  trimSilence,
  chunkAudio,
  normalizeAmplitude,
  isSilent,
  audioDurationSeconds,
  TARGET_SAMPLE_RATE,
  AudioError,
} from './audio.js'

export { renderTranscriptToSrt, renderTranscriptToVtt, renderTranscriptToMarkdown } from './format.js'