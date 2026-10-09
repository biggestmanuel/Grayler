'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { extractiveSummary } = require('../server/lib/extractive')
const { validateText, validateAudio, validateStyle } = require('../server/lib/validate')
const { parseModelJson } = require('../server/lib/summarize')

const MEETING = `Weekly sync, March 3.
Sarah: the migration to the new billing service slipped again. Postgres 15 upgrade is blocking the cutover.
Tom: we agreed to push the launch to April 12.
Decision: we will go with a staged rollout, starting with 5 percent of traffic.
Priya: action item, Tom will write the rollback runbook by Friday.
Action item: Sarah to file the vendor contract redlines before the next review.
We also agreed to stop shipping features until the billing work is stable.
Open question is whether we need a second on-call rotation for weekends.
It is still unclear whether the vendor will cover the overage costs.
Dave: metrics look good, error rate is down to 0.2 percent since Tuesday.`

test('extractive summary returns the full result shape', () => {
  const result = extractiveSummary(MEETING)

  assert.equal(typeof result.summary, 'string')
  assert.ok(result.summary.length > 0)
  assert.ok(Array.isArray(result.action_items))
  assert.ok(Array.isArray(result.decisions))
  assert.ok(Array.isArray(result.open_questions))
})

test('extractive summary finds the decisions in a transcript', () => {
  const { decisions } = extractiveSummary(MEETING)
  const joined = decisions.join(' | ')

  assert.match(joined, /April 12/)
  assert.match(joined, /staged rollout/i)
})

test('extractive summary separates action items from decisions', () => {
  const { action_items: items } = extractiveSummary(MEETING)

  assert.ok(items.some((item) => /runbook/i.test(item)), 'expected the runbook task')
  assert.ok(
    !items.some((item) => /staged rollout/i.test(item)),
    'a decision should not be repeated as an action item'
  )
})

test('extractive summary surfaces open questions', () => {
  const { open_questions: questions } = extractiveSummary(MEETING)
  assert.ok(questions.some((question) => /on-call|overage/i.test(question)))
})

test('extractive summary handles prose without line breaks', () => {
  const prose =
    'We reviewed the roadmap today. Ana will draft the migration plan by Thursday. ' +
    'The team agreed to defer the mobile release until Q3. It is unclear who owns the data backfill. ' +
    'Budget planning continues next week.'

  const result = extractiveSummary(prose)

  assert.ok(result.action_items.some((item) => /migration plan/i.test(item)))
  assert.ok(result.decisions.some((item) => /defer/i.test(item)))
  assert.ok(result.open_questions.some((item) => /data backfill/i.test(item)))
})

test('extractive summary never returns duplicates', () => {
  const repeated = `${MEETING}\n${MEETING}`
  const result = extractiveSummary(repeated)

  for (const list of [result.action_items, result.decisions, result.open_questions]) {
    assert.equal(new Set(list).size, list.length)
  }
})

test('extractive summary tolerates very short input', () => {
  const result = extractiveSummary('Hello there.')
  assert.equal(typeof result.summary, 'string')
  assert.deepEqual(result.decisions, [])
})

test('validateText rejects missing, short and oversized input', () => {
  assert.equal(validateText(undefined).status, 400)
  assert.equal(validateText('   ').status, 400)
  assert.equal(validateText('too short').status, 400)
  assert.equal(validateText('x'.repeat(70000)).status, 413)
})

test('validateText normalizes line endings and trims', () => {
  const result = validateText('  A meeting happened today and we discussed the roadmap.\r\nSecond line here.  ')
  assert.equal(result.ok, true)
  assert.equal(result.text.includes('\r'), false)
  assert.equal(result.text.startsWith(' '), false)
})

test('validateAudio rejects unsupported and malformed payloads', () => {
  assert.equal(validateAudio({}).status, 400)
  assert.equal(validateAudio({ data: 'abc', filename: 'notes.txt' }).status, 415)
  assert.equal(validateAudio({ data: 'not base64 !!', filename: 'a.mp3' }).status, 400)
})

test('validateAudio rejects payloads past the size cap', () => {
  const config = require('../server/config')
  const oversized = 'A'.repeat(config.maxAudioBytes + 1)

  assert.equal(validateAudio({ data: oversized, filename: 'a.webm' }).status, 413)
})

test('validateAudio accepts a data URL and derives a filename', () => {
  const result = validateAudio({
    data: 'data:audio/webm;base64,QUJD',
    filename: 'meeting.webm',
    mimeType: 'audio/webm',
  })

  assert.equal(result.ok, true)
  assert.equal(result.base64, 'QUJD')
  assert.equal(result.filename, 'audio.webm')
})

test('validateAudio derives an extension when the filename has none', () => {
  const result = validateAudio({ data: 'QUJD', mimeType: 'audio/mpeg' })
  assert.equal(result.ok, true)
  assert.equal(result.filename, 'audio.mp3')
})

test('validateStyle falls back to executive for unknown values', () => {
  assert.equal(validateStyle('bullet'), 'bullet')
  assert.equal(validateStyle('detailed'), 'detailed')
  assert.equal(validateStyle('nonsense'), 'executive')
  assert.equal(validateStyle(undefined), 'executive')
})

test('parseModelJson handles plain, fenced and noisy responses', () => {
  assert.deepEqual(parseModelJson('{"summary":"a"}'), { summary: 'a' })

  assert.deepEqual(parseModelJson('```json\n{"summary":"b"}\n```'), { summary: 'b' })
  assert.deepEqual(parseModelJson('Sure! Here you go: {"summary":"c"} Hope that helps.'), {
    summary: 'c',
  })
  assert.deepEqual(parseModelJson('{"summary":"has } inside","x":1}'), {
    summary: 'has } inside',
    x: 1,
  })
})

test('parseModelJson returns null for unusable output', () => {
  assert.equal(parseModelJson(''), null)
  assert.equal(parseModelJson('no json at all'), null)
  assert.equal(parseModelJson('{ broken'), null)
})