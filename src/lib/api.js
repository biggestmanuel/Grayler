// Thin fetch wrapper around the Grayler API. Every failure path resolves to an
// Error carrying a message that is safe to show to the user.

const BASE = import.meta.env.VITE_API_URL || ''

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { signal, ...options } = {}) {
  let response

  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError('Could not reach the server. Is the API running?', 0)
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json')
  const payload = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status}).`, response.status)
  }

  return payload
}

export function getHealth(signal) {
  return request('/api/health', { signal })
}

export function postSummarize({ text, style }, signal) {
  return request(
    '/api/summarize',
    { method: 'POST', signal, body: JSON.stringify({ text, style }) }
  )
}

export function postTranscribe({ data, filename, mimeType }, signal) {
  return request(
    '/api/transcribe',
    { method: 'POST', signal, body: JSON.stringify({ data, filename, mimeType }) }
  )
}