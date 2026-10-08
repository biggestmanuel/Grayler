'use strict'

const express = require('express')

const config = require('./config')
const rateLimit = require('./lib/rate-limit')
const { isConfigured } = require('./lib/groq')
const { validateText, validateAudio, validateStyle } = require('./lib/validate')
const { summarize } = require('./lib/summarize')
const { transcribe } = require('./lib/transcribe')

/**
 * Builds the Express app used by the local dev server and by the Vercel
 * functions in /api. Keeping route logic in one place means the two
 * deployment targets cannot drift.
 */
function createApp() {
  const app = express()

  app.set('trust proxy', 1)

  // Restrict CORS to known origins when configured; otherwise allow any origin so
  // the local dev proxy and preview deployments keep working.
  const allowAll = config.allowedOrigins.length === 0
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (!origin || allowAll || config.allowedOrigins.includes(origin)) {
      if (origin && !allowAll) res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      return next()
    }
    res.status(403).json({ error: 'Origin not allowed.' })
  })

  // Some platforms (Vercel) parse the JSON body before handing the request to
  // the function, which would leave nothing for express to read. Skip parsing
  // in that case instead of hanging on an already-consumed stream.
  const jsonParser = express.json({ limit: '12mb' })
  app.use((req, res, next) => {
    if (req.body !== undefined) return next()
    return jsonParser(req, res, next)
  })

  function guard(options) {
    return (req, res, next) => {
      const { allowed, retryAfterSeconds } = rateLimit.hit(req, options)
      if (!allowed) {
        res.setHeader('Retry-After', String(retryAfterSeconds))
        return res.status(429).json({
          error: `Too many requests. Try again in about ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        })
      }
      next()
    }
  }

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      mode: isConfigured() ? 'groq' : 'extractive',
      models: { summarize: config.chatModel, transcribe: config.transcribeModel },
      maxChars: config.maxChars,
      maxAudioBytes: config.maxAudioBytes,
    })
  })

  app.post('/api/summarize', guard(config.summarizeRate), async (req, res, next) => {
    try {
      const validated = validateText(req.body?.text)
      if (!validated.ok) return res.status(validated.status).json({ error: validated.error })

      const result = await summarize(validated.text, validateStyle(req.body?.style))
      return res.json(result)
    } catch (e) {
      return next(e)
    }
  })

  app.post('/api/transcribe', guard(config.transcribeRate), async (req, res, next) => {
    try {
      const validated = validateAudio(req.body || {})
      if (!validated.ok) return res.status(validated.status).json({ error: validated.error })

      const result = await transcribe(validated)
      if (!result.ok) return res.status(result.status).json({ error: result.error })

      return res.json({ text: result.text, model: config.transcribeModel })
    } catch (e) {
      return next(e)
    }
  })

  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }))

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500
    if (status >= 500) console.error('[grayler] unhandled error:', err)
    const message =
      status === 413
        ? 'Request body is too large. Try a shorter clip or paste less text.'
        : 'Something went wrong on the server. Please try again.'
    res.status(status).json({ error: message })
  })

  // Serve the built frontend when it exists, so `npm run build && npm start`
  // runs the whole product from one process. On Vercel the static build is
  // served separately and this bundle has no dist/, so it is skipped.
  const path = require('path')
  const fs = require('fs')
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html')

  if (fs.existsSync(distIndex)) {
    app.use(express.static(path.join(__dirname, '..', 'dist'), { maxAge: '1h', index: false }))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(distIndex, (err) => {
        if (err) next(err)
      })
    })
  }

  return app
}

module.exports = { createApp }