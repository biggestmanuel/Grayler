/**
 * Runs the API server and the Vite dev server together with prefixed output.
 * Keeps `npm run dev` to a single command without adding a process runner
 * dependency.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const COLORS = { api: '[36m', web: '[35m' }
const RESET = '[0m'

const children = []
let shuttingDown = false

function run(name, args) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: process.env,
  })

  const prefix = `${COLORS[name] || ''}[${name}]${RESET} `
  const pipe = (stream, target) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) target.write(`${prefix}${line}\n`)
    })
  }

  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)

  child.on('exit', (code) => {
    if (shuttingDown) return
    process.stdout.write(`${prefix}exited with code ${code}\n`)
    shutdown(code ?? 0)
  })

  children.push(child)
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

if (!existsSync(join(root, '.env'))) {
  process.stdout.write(
    '[dev] no .env found — copy .env.example to .env and add GROQ_API_KEY for LLM-quality summaries\n'
  )
}

run('api', ['run', 'start-server'])
run('web', ['run', 'dev:client'])