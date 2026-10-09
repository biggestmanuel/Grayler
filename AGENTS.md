# AGENTS.md

Working agreements for agents and contributors on this repository.

## Commit and push

**After every file change, commit and push.**

Do not batch up a long series of edits and push once at the end. Each logical
change lands as its own commit on `main`, pushed to `origin` as soon as it is
complete and verified.

Before committing and pushing, always do this:

1. **Review the diff for secrets.** Search for API keys, tokens, passwords, and
   credentials before every commit. The Groq key prefix is `gsk_`; also look for
   `sk-`, `ghp_`, `github_pat_`, `AKIA...`, `xox?-`, `AIza...`, and any
   `-----BEGIN ... PRIVATE KEY-----` block. Confirm `.env` is still gitignored
   and that `.env.example` holds placeholders only, never real values.
2. **Run the checks.** `npm test` and `npm run build` must both pass.
3. **Write a real commit message.** Explain what changed and why. Describe the
   problem being fixed, not just the files touched.

If a review turns up a leaked credential, stop and tell the user before
committing. Rotate it rather than just removing it from the working tree; a
committed secret stays in git history even after a later commit deletes it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API and Vite dev server together |
| `npm run dev:client` | Frontend only |
| `npm run dev:server` | API only |
| `npm test` | node:test suite |
| `npm run build` | Production build to `dist/` |
| `npm start` | Serves `dist/` and the API from one process |
| `npm run assets` | Regenerate logo and OG image |

## Architecture

- `server/app.js` is the only definition of the routes. The local dev server and
  the Vercel function in `api/[...path].js` both use it, so add routes there
  rather than in the entry points.
- `server/config.js` reads env vars and holds all limits. Frontend limits come
  from `GET /api/health`; do not hardcode them in components.
- `server/lib/extractive.js` is the no-API-key fallback. Every result shape must
  stay consistent whether the summary came from Groq or the fallback.
- `local-transcriber/` is a self-contained, portable on-device speech-to-text
  module (Whisper in the browser via transformers.js). It depends only on
  `@huggingface/transformers` and must stay copy-pasteable into other projects,
  so keep Grayler-specific code out of it.
- Server files are CommonJS; the frontend is ESM via Vite. `vite.config.mjs` is
  `.mjs` on purpose, since adding `"type": "module"` would break the server.
- Keep the dependency count low. Prefer plain Node built-ins over a new package,
  as `scripts/optimize-assets.mjs` does with `node:zlib`.

## Verifying changes

Unit tests do not cover everything. Audio decode, resampling, workers, and model
inference only work in a real browser, so exercise UI changes by running the
app and driving it. `toWhisperInput` shipped a frame-count bug that silently
truncated all audio to silence and no unit test could have caught it, because the
code needs `OfflineAudioContext` to run at all.

## Conventions

- No secrets in code, in committed files, or in the client bundle. The Groq key
  stays server-side; only the Vite proxy passes requests through.
- Validate and length-cap every input at the server boundary.
- Surface the server's real error message to the user. Do not collapse failures
  into a generic string.
- Prefer accessibility: labelled controls, visible focus, and `aria-live` for
  async status.
- Add a test alongside a behavior change.

## Deploying

`vercel.json` builds the frontend and maps `/api/*` to the serverless function.
`GROQ_API_KEY` must be set as a Vercel environment variable. Rate limiting is
per-process, so it does not bound abuse across serverless instances. If this
becomes a public deployment, it needs real access control in front of the paid
API key.