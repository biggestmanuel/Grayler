const express = require('express')
const bodyParser = require('body-parser')

// Use groq client if you want LLM answers. Read GROQ_API_KEY from env.
// This server is a lightweight proxy to keep API keys off the browser.

const app = express()
app.use(bodyParser.json())

const GROQ_KEY = process.env.GROQ_API_KEY
let groqClient = null
if(GROQ_KEY){
  try{
    const Groq = require('groq')
    groqClient = new Groq({ apiKey: GROQ_KEY })
  }catch(e){
    console.warn('Groq client not installed or failed to load, fallback to extractive response')
  }
}

app.post('/api/summarize', async (req, res) => {
  const { text } = req.body || {}
  if(!text) return res.status(400).json({ error: 'missing text' })

  if(groqClient){
    try{
      const resp = await groqClient.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {role:'system', content: 'You are a meeting assistant. Produce a concise executive summary, bullet action items, and bullet list of decisions. Use the text provided and do not invent facts.'},
          {role:'user', content: `Meeting text:\n\n${text}`}
        ],
        temperature:0.2,
        max_tokens:500
      })
      const answer = resp.choices?.[0]?.message?.content || ''
      // Very simple parsing: split sections by headers
      const summary = answer
      return res.json({ summary, action_items: [], decisions: [] })
    }catch(e){
      console.error('groq error', e)
      return res.status(500).json({ error: 'LLM error' })
    }
  }

  // Fallback: simple extractive heuristic
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean)
  const summary = lines.slice(0,3).join(' ')
  const action_items = lines.filter(l=>/action|todo|next|follow/i.test(l)).slice(0,5)
  const decisions = lines.filter(l=>/decide|decision|agreed|agree/i.test(l)).slice(0,5)
  res.json({ summary, action_items, decisions })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, ()=> console.log('Grayler server listening on', PORT))
