'use strict'

const config = require('../config')

let client = null
let clientForKey = null

/**
 * Lazily builds a Groq client. Kept lazy so the server can boot without a key
 * and fall back to the extractive summarizer instead of crashing on startup.
 */
function getClient() {
  const key = config.apiKey
  if (!key) return null
  if (client && clientForKey === key) return client

  try {
    const Groq = require('groq-sdk')
    client = new Groq({ apiKey: key, maxRetries: 1, timeout: config.requestTimeoutMs })
    clientForKey = key
    return client
  } catch (e) {
    console.warn('[grayler] groq-sdk unavailable, using extractive fallback:', e.message)
    client = null
    clientForKey = null
    return null
  }
}

function isConfigured() {
  return Boolean(config.apiKey)
}

module.exports = { getClient, isConfigured }