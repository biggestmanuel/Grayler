'use strict'

const config = require('../config')
const { getClient, isConfigured } = require('./groq')
const { validateText } = require('./validate')

/**
 * Transcribes audio using Groq Whisper.
 *
 * @returns {Promise<{ok: true, text: string} | {ok: false, status: number, error: string}>}
 */
async function transcribe({ base64, filename }) {
  if (!isConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'Transcription needs a GROQ_API_KEY on the server. Add it to .env and restart.',
    }
  }

  const client = getClient()
  if (!client) {
    return { ok: false, status: 503, error: 'Transcription is unavailable right now. Please try again shortly.' }
  }

  let buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch (e) {
    return { ok: false, status: 400, error: 'Could not read the audio data.' }
  }

  if (!buffer.length) {
    return { ok: false, status: 400, error: 'The audio file appears to be empty.' }
  }

  try {
    const response = await client.audio.transcriptions.create({
      model: config.transcribeModel,
      file: await toFile(buffer, filename),
      response_format: 'json',
      temperature: 0,
    })

    const text = (response?.text || '').trim()
    if (!text) {
      return { ok: false, status: 422, error: 'No speech was detected in that audio.' }
    }

    const validated = validateText(text)
    if (!validated.ok) {
      return { ok: false, status: validated.status, error: validated.error }
    }

    return { ok: true, text }
  } catch (e) {
    console.error('[grayler] transcription failed:', e.message)
    return {
      ok: false,
      status: 502,
      error: 'Transcription failed. The audio may be unsupported or too long.',
    }
  }
}

/** Builds a File for the SDK's multipart upload. */
async function toFile(buffer, filename) {
  const { File } = require('node:buffer')
  const blob = new File([buffer], filename)
  return blob
}

module.exports = { transcribe }