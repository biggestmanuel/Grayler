'use strict'

const config = require('./config')
const { createApp } = require('./app')
const { isConfigured } = require('./lib/groq')

const app = createApp()

app.listen(config.port, () => {
  console.log(`[grayler] API listening on http://localhost:${config.port}`)
  console.log(
    isConfigured()
      ? `[grayler] summarization mode: groq (${config.chatModel})`
      : '[grayler] GROQ_API_KEY not set — using the offline extractive summarizer'
  )
})