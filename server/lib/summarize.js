'use strict'

const config = require('../config')
const { getClient } = require('./groq')
const { extractiveSummary } = require('./extractive')

const SUMMARY_STYLES = {
  executive: 'Write the summary as a tight executive brief of 3-4 sentences for someone who missed the meeting.',
  detailed: 'Write a detailed summary of up to 8 sentences that preserves context, numbers, names and open questions.',
  bullet: 'Write the summary as a single string of 4-6 short bullet points, each starting with "- ".',
}

const BASE_PROMPT = [
  'You are a precise meeting assistant.',
  'Read the meeting text and return ONLY a JSON object with exactly these keys:',
  '"summary" (a string),',
  '"action_items" (an array of short imperative strings, each naming an owner when the text provides one),',
  '"decisions" (an array of short strings),',
  '"open_questions" (an array of short strings for anything left unresolved, blocked, or awaiting a decision).',
  '',
  'Rules:',
  '- Never invent facts, owners, dates or commitments that are not in the text.',
  '- Return empty arrays when the text contains nothing for that key.',
  '- Do not wrap the JSON in markdown fences or add commentary.',
]

const systemPromptFor = (style) =>
  [...BASE_PROMPT, '', SUMMARY_STYLES[style] || SUMMARY_STYLES.executive].join('\n')

function coerceStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim()
      if (entry && typeof entry === 'object') {
        const owner = typeof entry.owner === 'string' ? entry.owner.trim() : ''
        const text = typeof entry.task === 'string' ? entry.task.trim() : typeof entry.text === 'string' ? entry.text.trim() : ''
        const joined = [text, owner && `— ${owner}`].filter(Boolean).join(' ')
        return joined.trim()
      }
      return ''
    })
    .filter(Boolean)
}

function coerceSummary(value) {
  if (typeof value === 'string') return value.trim()
  // Tolerate models that return an array of summary sentences.
  if (Array.isArray(value)) return coerceStringArray(value).join(' ')
  return ''
}

/** Pulls the first balanced JSON object out of a model response. */
function parseModelJson(raw) {
  const text = (raw || '').trim()
  if (!text) return null

  const unfenced = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  try {
    return JSON.parse(unfenced)
  } catch (_) {
    /* fall through to bracket scanning */
  }

  const start = unfenced.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < unfenced.length; i++) {
    const char = unfenced[i]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1))
        } catch (_) {
          return null
        }
      }
    }
  }

  return null
}

function withMeta(result, mode) {
  return {
    ...result,
    summary: result.summary || '',
    action_items: coerceStringArray(result.action_items),
    decisions: coerceStringArray(result.decisions),
    open_questions: coerceStringArray(result.open_questions || result.openQuestions),
    mode,
    model: mode === 'groq' ? config.chatModel : 'extractive',
  }
}

/**
 * Summarizes meeting text. Uses Groq when configured and degrades to the
 * extractive summarizer instead of surfacing an error to the user.
 */
async function summarize(text, style = 'executive') {
  const client = getClient()

  if (!client) {
    return withMeta(extractiveSummary(text), 'extractive')
  }

  try {
    const response = await client.chat.completions.create({
      model: config.chatModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPromptFor(style) },
        { role: 'user', content: `Meeting text:\n\n${text}` },
      ],
      temperature: 0.2,
      max_tokens: 900,
    })

    const raw = response.choices?.[0]?.message?.content || ''
    const parsed = parseModelJson(raw)

    if (!parsed) {
      console.warn('[grayler] could not parse model JSON, falling back to extractive')
      return withMeta(extractiveSummary(text), 'extractive')
    }

    const result = withMeta(
      {
        summary: coerceSummary(parsed.summary),
        action_items: parsed.action_items,
        decisions: parsed.decisions,
        open_questions: parsed.open_questions,
      },
      'groq'
    )

    // A model that returns nothing usable is worse than the offline path.
    if (
      !result.summary &&
      !result.action_items.length &&
      !result.decisions.length &&
      !result.open_questions.length
    ) {
      return withMeta(extractiveSummary(text), 'extractive')
    }

    return result
  } catch (e) {
    console.error('[grayler] groq summarize failed, falling back to extractive:', e.message)
    return withMeta(extractiveSummary(text), 'extractive')
  }
}

module.exports = { summarize, parseModelJson, SUMMARY_STYLES }