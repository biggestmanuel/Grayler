# Grayler

Meeting notes summarizer. Paste notes or drop a recording, get a summary, action
items, decisions, and open questions.

## Quick start

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY
npm run dev               # API on :3001 + Vite on :5173
```

`npm run dev` runs both processes together. To run them separately use
`npm run dev:server` and `npm run dev:client`.

Without `GROQ_API_KEY` the app still works: it falls back to a local extractive
summarizer and labels the result "Offline extractive". Audio transcription is
unavailable without a key.

Get a key at https://console.groq.com/keys

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API and Vite dev server together |
| `npm run build` | Production frontend build to `dist/` |
| `npm start` | Serves `dist/` and the API from one process on `PORT` |
| `npm test` | Runs the `node --test` suite |
| `npm run assets` | Regenerates `public/logo.png` and `public/og.png` |

## How it is put together

```
index.html            Vite entry
src/                  React frontend
  components/         Summarizer, AudioPanel, ResultView, HistoryPanel
  lib/                api client, history storage, markdown, audio helpers
server/
  app.js              Express app shared by local dev and Vercel
  index.js            Local entry point
  config.js           Env loading and limits
  lib/                summarize, transcribe, extractive fallback, validation, rate limit
api/[...path].js      Vercel function entry, delegates to server/app.js
scripts/              dev runner, asset generation
test/                 node:test suites
```

The Express app in `server/app.js` is the single source of route logic. Local dev
runs it directly; the Vercel function wraps it, so the two cannot drift.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Active mode, models, and limits |
| `POST /api/summarize` | `{ text, style }` → `{ summary, action_items, decisions, open_questions, mode, model }` |
| `POST /api/transcribe` | `{ data, filename, mimeType }` → `{ text, model }` (base64 audio) |

`style` is one of `executive` (default), `detailed`, or `bullet`.

Inputs are validated and length-capped, and both endpoints are rate limited per
IP. Rate limit state is per-process, so on serverless it is a floor rather than a
hard cap.

## Configuration

All optional except `GROQ_API_KEY`. See `.env.example` for the full list,
including model overrides, `MAX_INPUT_CHARS`, `MAX_AUDIO_BYTES`,
`REQUEST_TIMEOUT_MS`, and `ALLOWED_ORIGINS`.

## Deployment

`vercel.json` builds the frontend to `dist/` and maps `/api/*` to the serverless
function. Set `GROQ_API_KEY` in the Vercel project environment variables.

To deploy somewhere else, `npm run build && npm start` serves the whole app from
one Node process.

## Notes on data

Meeting text is sent to the server to produce a summary and is not persisted
anywhere. Saved summaries live in the browser's `localStorage` only. Audio is
transcribed server-side by Groq and discarded after the request.

If you deploy this publicly, put it behind some form of access control before
pointing a real Groq key at it — rate limiting alone will not stop abuse.