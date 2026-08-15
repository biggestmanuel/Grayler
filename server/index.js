const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(bodyParser.json())

const GROQ_KEY = process.env.GROQ_API_KEY
let groqClient = null
if (GROQ_KEY) {
  try {
    const Groq = require('groq-sdk')
    groqClient = new Groq({ apiKey: GROQ_KEY })
  } catch (e) {
    console.warn('groq-sdk not installed or failed to load, fallback to extractive response')
  }
}

function extractiveFallback(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const summary = lines.slice(0, 3).join(' ')
  const action_items = lines.filter(l => /action|todo|next|follow/i.test(l)).slice(0, 5)
  const decisions = lines.filter(l => /decide|decision|agreed|agree/i.test(l)).slice(0, 5)
  return { summary, action_items, decisions }
}

app.post('/api/summarize', async (req, res) => {
  const { text } = req.body || {}
  if (!text) return res.status(400).json({ error: 'missing text' })

  if (groqClient) {
    try {
      const resp = await groqClient.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a meeting assistant. Read the meeting text and return ONLY a JSON object with exactly these keys: "summary" (a concise executive summary as a string), "action_items" (an array of short strings), "decisions" (an array of short strings). Do not invent facts. If there are no action items or decisions, return empty arrays.'
          },
          { role: 'user', content: `Meeting text:\n\n${text}` }
        ],
        temperature: 0.2,
        max_tokens: 600
      })
      const raw = resp.choices?.[0]?.message?.content || '{}'
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (parseErr) {
        console.warn('Could not parse LLM JSON, falling back to raw text as summary')
        parsed = { summary: raw, action_items: [], decisions: [] }
      }
      return res.json({
        summary: parsed.summary || '',
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : []
      })
    } catch (e) {
      console.error('groq error', e)
      return res.status(500).json({ error: 'LLM error' })
    }
  }

  res.json(extractiveFallback(text))
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log('Grayler server listening on', PORT))
