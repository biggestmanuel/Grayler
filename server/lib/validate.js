'use strict'

const config = require('../config')

const AUDIO_EXTENSIONS = /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i
const AUDIO_MIME_PREFIX = /^audio\//
const AUDIO_MIME_ALLOWLIST = new Set([
  'audio/flac',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/mpga',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/webm;codecs=opus',
])

/**
 * Validates and normalizes pasted meeting text.
 * @returns {{ok: true, text: string} | {ok: false, status: number, error: string}}
 */
function validateText(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, error: 'Request body must include a "text" string.' }
  }

  const text = raw.replace(/\r\n/g, '\n').trim()

  if (!text) {
    return { ok: false, status: 400, error: 'Nothing to summarize. Paste some meeting notes first.' }
  }
  if (text.length < 20) {
    return {
      ok: false,
      status: 400,
      error: 'That is too short to summarize. Paste at least a few sentences of notes.',
    }
  }
  if (text.length > config.maxChars) {
    return {
      ok: false,
      status: 413,
      error: `Input is too long (${text.length.toLocaleString()} characters). The limit is ${config.maxChars.toLocaleString()}.`,
    }
  }

  return { ok: true, text }
}

/**
 * Validates base64 audio payloads produced by the client.
 * The Whisper API accepts flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav and webm.
 */
function validateAudio({ data, filename, mimeType } = {}) {
  if (typeof data !== 'string' || !data.trim()) {
    return { ok: false, status: 400, error: 'No audio data received.' }
  }
  if (data.length > config.maxAudioBytes) {
    return {
      ok: false,
      status: 413,
      error: 'Audio file is too large. Try a shorter clip or a more compressed format.',
    }
  }

  const name = typeof filename === 'string' ? filename : ''
  const mime = typeof mimeType === 'string' ? mimeType.toLowerCase().split(';')[0].trim() : ''

  const mimeAllowed = mime ? AUDIO_MIME_ALLOWLIST.has(mime) || mime.startsWith('audio/') : false
  const extAllowed = name ? AUDIO_EXTENSIONS.test(name) : false

  if (!mimeAllowed && !extAllowed) {
    return {
      ok: false,
      status: 415,
      error: 'Unsupported audio format. Use mp3, m4a, wav, ogg, webm, mp4 or flac.',
    }
  }

  // Accept both raw base64 and a data URL, and hand the API a clean filename.
  const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(base64.replace(/\s/g, ''))) {
    return { ok: false, status: 400, error: 'Audio data was not valid base64.' }
  }

  const extMatch = name.match(AUDIO_EXTENSIONS)
  const fallbackExt = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : 'mp3'
  const filenameOut = extMatch ? `audio${extMatch[0].toLowerCase()}` : `audio.${fallbackExt}`

  return { ok: true, base64, filename: filenameOut }
}

const SUMMARY_STYLES = ['executive', 'detailed', 'bullet']

/** Normalizes the requested summary style to a known value. */
function validateStyle(raw) {
  return typeof raw === 'string' && SUMMARY_STYLES.includes(raw) ? raw : 'executive'
}

module.exports = { validateText, validateAudio, validateStyle, SUMMARY_STYLES }