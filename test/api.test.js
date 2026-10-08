'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../server/app')
const rateLimit = require('../server/lib/rate-limit')

const app = createApp()
const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`

test.after(() => server.close())

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const NOTES =
  'Weekly sync. Tom will write the rollback runbook by Friday. We agreed to push the launch to April 12. ' +
  'Open question is whether we need a second on-call rotation for weekends. Metrics look good.'

test('health reports the active mode and limits', async () => {
  const res = await fetch(`${base}/api/health`)
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.ok(['groq', 'extractive'].includes(body.mode))
  assert.ok(body.maxChars > 0)
  assert.ok(body.maxAudioBytes > 0)
})

test('summarize returns a summary for valid notes', async () => {
  const res = await post('/api/summarize', { text: NOTES })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.ok(body.summary.length > 0, 'expected a non-empty summary')
  assert.ok(Array.isArray(body.action_items))
  assert.ok(Array.isArray(body.decisions))
  assert.ok(['groq', 'extractive'].includes(body.mode))
})

test('summarize rejects empty input with a helpful message', async () => {
  const res = await post('/api/summarize', { text: '   ' })
  const body = await res.json()

  assert.equal(res.status, 400)
  assert.match(body.error, /nothing to summarize/i)
})

test('summarize rejects input over the length cap', async () => {
  const res = await post('/api/summarize', { text: 'word '.repeat(20000) })
  const body = await res.json()

  assert.equal(res.status, 413)
  assert.match(body.error, /too long/i)
})

test('summarize accepts every documented style', async () => {
  for (const style of ['executive', 'detailed', 'bullet', 'garbage']) {
    const res = await post('/api/summarize', { text: NOTES, style })
    assert.equal(res.status, 200, `style ${style} should be accepted`)
  }
})

test('transcribe reports a clear error when no API key is configured', async () => {
  const res = await post('/api/transcribe', {
    data: 'QUJD',
    filename: 'meeting.webm',
    mimeType: 'audio/webm',
  })
  const body = await res.json()

  if (require('../server/config').apiKey) {
    // With a key configured an empty payload is the realistic failure.
    assert.ok([400, 422, 502].includes(res.status))
  } else {
    assert.equal(res.status, 503)
    assert.match(body.error, /GROQ_API_KEY/)
  }
})

test('unknown api routes return JSON 404', async () => {
  const res = await post('/api/nope', {})
  assert.equal(res.status, 404)
  assert.match((await res.json()).error, /unknown endpoint/i)
})

test('malformed JSON returns 400 rather than crashing', async () => {
  const res = await fetch(`${base}/api/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"text": ',
  })

  assert.equal(res.status, 400)
})

test('OPTIONS preflight is answered', async () => {
  const res = await fetch(`${base}/api/summarize`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.com' },
  })
  assert.equal(res.status, 204)
})

test('rate limiter blocks once the window is exhausted', () => {
  rateLimit.reset()
  const req = { headers: { 'x-forwarded-for': '203.0.113.7' }, ip: '203.0.113.7' }
  const limit = { windowMs: 60000, max: 3 }

  assert.equal(rateLimit.hit(req, limit).allowed, true)
  assert.equal(rateLimit.hit(req, limit).allowed, true)
  assert.equal(rateLimit.hit(req, limit).allowed, true)

  const blocked = rateLimit.hit(req, limit)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSeconds > 0)
})

test('rate limiter reports 429 to clients that exceed it', async () => {
  // The transcribe budget is the tightest, so exhaust a dedicated instance.
  const originalConfig = require('../server/config').transcribeRate
  require('../server/config').transcribeRate = { windowMs: 60000, max: 1 }
  const isolated = createApp().listen(0)
  const url = `http://127.0.0.1:${isolated.address().port}/api/transcribe`

  const body = JSON.stringify({ data: 'QUJD', filename: 'a.webm', mimeType: 'audio/webm' })
  const send = () =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

  await send()
  const second = await send()

  require('../server/config').transcribeRate = originalConfig
  isolated.close()

  assert.equal(second.status, 429)
  assert.match((await second.json()).error, /too many requests/i)
})