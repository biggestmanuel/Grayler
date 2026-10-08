'use strict'

/**
 * Dependency-free extractive summarizer.
 *
 * Used when GROQ_API_KEY is missing or the LLM call fails, so the app still
 * returns something useful at zero cost. Scores sentences by the frequency of
 * their content words, then keeps the highest scoring ones in document order.
 */

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below
   between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few
   for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i if
   in into is isn't it its itself let's me more most mustn't my myself no nor not of off on once only or other
   ought our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs
   them themselves then there these they this those through to too under until up very was wasn't we were weren't
   what when where which while who whom why with won't would wouldn't you your yours yourself yourselves
   ok okay yeah yes just like get got gonna really thing things also would could may might will shall
   said says say going know think want need make made take see look one two`.split(/\s+/)
)

const ACTION_RE = /\b(action item|todo|to-do|next step|follow[- ]?up|will\b|should\b|must\b|need(?:s|ed)? to|assign(?:ed)? to|owner|deadline|due by|deliver)\b/i
const DECISION_RE = /\b(decision|decided|we(?:'ve| have)? agreed|agreed to|consensus|approved|sign(?:ed)? off|resolved|concluded|we will go with|chose|chosen|ratif\w*)\b/i
const QUESTION_RE = /\b(open question|unresolved|still need(?:s)? to|tbd|to be determined|unclear|not sure|blocked on|waiting on|depends? on|parked|follow up on|deferred|nobody knows)\b/i

function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function contentWords(sentence) {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

function sentencesForSummary(text, count = 5) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const candidates = []

  for (const line of lines) {
    const isBullet = /^([-*•]|\d+[.)])\s+/.test(line)
    if (isBullet) {
      candidates.push({ text: line.replace(/^([-*•]|\d+[.)])\s+/, ''), weight: 1.15 })
      continue
    }
    for (const sentence of splitSentences(line)) {
      candidates.push({ text: sentence, weight: 1 })
    }
  }

  if (!candidates.length) return []

  const frequency = new Map()
  for (const { text: sentence } of candidates) {
    for (const word of contentWords(sentence)) {
      frequency.set(word, (frequency.get(word) || 0) + 1)
    }
  }

  const maxFreq = Math.max(1, ...frequency.values())
  const scored = candidates.map((candidate, index) => {
    const words = contentWords(candidate.text)
    if (!words.length) return { ...candidate, index, score: 0 }

    let score = 0
    for (const word of words) score += (frequency.get(word) || 0) / maxFreq

    // Normalize by length so long sentences don't dominate, and favor sentences
    // near the top, which in meeting notes usually carry the headline.
    score = score / Math.sqrt(words.length) * candidate.weight
    if (ACTION_RE.test(candidate.text) || DECISION_RE.test(candidate.text)) score *= 1.08
    if (index < 5) score *= 1.15

    return { ...candidate, index, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
}

/**
 * Collects items that look like `re` — pulling from bullet lines first, then
 * from sentences inside prose so wrapped transcripts are handled too.
 * `exclude` drops lines already claimed by another category.
 */
function bulletsMatching(text, re, count = 7, exclude = []) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  const keep = (value) =>
    re.test(value) &&
    value.length < 300 &&
    !exclude.some((other) => other.test(value))

  const fromBullets = lines
    .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
    .map(stripBullet)
    .filter(keep)

  const prose = lines
    .filter((l) => !/^([-*•]|\d+[.)])\s+/.test(l))
    .flatMap((l) => (l.length < 300 ? [l] : splitSentences(l)))
    .filter((s) => s.length < 300)

  const fromProse = sentencesForSummary(prose.join('\n'), count * 3).filter(keep)

  const seen = new Set()
  return [...fromBullets, ...fromProse]
    .filter((item) => {
      const key = item.toLowerCase().replace(/\W+/g, ' ').trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, count)
}

function stripBullet(line) {
  return line.replace(/^([-*•]|\d+[.)])\s+/, '').trim()
}

function extractiveSummary(text) {
  const summarySentences = sentencesForSummary(text, 5)

  // A line that reads as a decision or an open question is not an action item,
  // even though it often contains "will" or "should".
  const notAction = [DECISION_RE, QUESTION_RE]

  return {
    summary: summarySentences.join(' ') || text.slice(0, 400).trim(),
    action_items: bulletsMatching(text, ACTION_RE, 7, notAction),
    decisions: bulletsMatching(text, DECISION_RE, 7, [QUESTION_RE]),
    open_questions: bulletsMatching(text, QUESTION_RE, 5),
  }
}

module.exports = { extractiveSummary }