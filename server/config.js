'use strict'

// Vercel injects env vars directly; local dev reads a .env file if present.
// This is a no-op when no .env exists, so the same config works in both places.
try {
  require('dotenv').config()
} catch (_) {
  /* dotenv not installed or no .env file — env vars may come from the platform */
}

const DEFAULTS = {
  port: 3001,
  chatModel: 'llama-3.1-8b-instant',
  transcribeModel: 'whisper-large-v3-turbo',
  maxChars: 60000,
  requestTimeoutMs: 60000,
  // Keeps a single deployment instance from being used as a free LLM relay.
  summarizeRate: { windowMs: 10 * 60 * 1000, max: 30 },
  transcribeRate: { windowMs: 60 * 60 * 1000, max: 12 },
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

module.exports = {
  get apiKey() {
    return process.env.GROQ_API_KEY || ''
  },
  port: int(process.env.PORT, DEFAULTS.port),
  chatModel: process.env.GROQ_MODEL || DEFAULTS.chatModel,
  transcribeModel: process.env.GROQ_TRANSCRIBE_MODEL || DEFAULTS.transcribeModel,
  maxChars: int(process.env.MAX_INPUT_CHARS, DEFAULTS.maxChars),
  requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
  // 12 MB of JSON leaves room for base64 audio within Vercel's 4.5 MB request cap
  // after the client's own compression.
  maxAudioBytes: int(process.env.MAX_AUDIO_BYTES, 8 * 1024 * 1024),
  summarizeRate: DEFAULTS.summarizeRate,
  transcribeRate: DEFAULTS.transcribeRate,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}