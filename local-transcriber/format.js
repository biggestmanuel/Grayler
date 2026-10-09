/**
 * Transcript formatting: plain text, SRT, WebVTT, and Markdown.
 *
 * All three subtitle formats are built from the timestamped chunks. When only
 * plain text is available, one full-length cue is emitted so the output is
 * still a valid subtitle file rather than an empty one.
 */

function pad(value, width = 2) {
  return String(Math.floor(value)).padStart(width, '0')
}

function formatTimestamp(seconds, { milliseconds = true, separator = ',' } = {}) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  const ms = Math.round((safe - Math.floor(safe)) * 1000)

  const base = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
  return milliseconds ? `${base}${separator}${pad(ms, 3)}` : base
}

function toCues(chunks, text) {
  const usable = (chunks || [])
    .map((chunk) => ({
      text: (chunk.text || '').trim(),
      start: Number(chunk.start) || 0,
      end: Number.isFinite(chunk.end) ? Number(chunk.end) : null,
    }))
    .filter((cue) => cue.text)

  if (usable.length) {
    // Whisper sometimes reports a null end; extend to the next cue's start.
    return usable.map((cue, index) => ({
      ...cue,
      end: cue.end ?? usable[index + 1]?.start ?? cue.start + 3,
    }))
  }

  // No timestamps: fall back to a single cue covering the whole clip.
  return text ? [{ text: text.trim(), start: 0, end: 0 }] : []
}

export function renderTranscriptToSrt(result) {
  const cues = toCues(result.chunks, result.text)
  if (!cues.length) return ''

  return (
    cues
      .map(
        (cue, index) =>
          `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`
      )
      .join('\n\n') + '\n'
  )
}

export function renderTranscriptToVtt(result) {
  const cues = toCues(result.chunks, result.text)
  if (!cues.length) return 'WEBVTT\n\n'

  const header = result.language && result.language !== 'auto' ? `NOTE Language: ${result.language}` : ''

  const body = cues
    .map(
      (cue) =>
        `${formatTimestamp(cue.start, { separator: '.' })} --> ${formatTimestamp(cue.end, {
          separator: '.',
        })}\n${cue.text}`
    )
    .join('\n\n')

  return `WEBVTT\n\n${header ? `${header}\n\n` : ''}${body}\n`
}

export function renderTranscriptToMarkdown(result, { title = 'Transcript' } = {}) {
  const lines = [`# ${title}`, '']

  const meta = []
  if (result.model) meta.push(`Model: ${result.model}`)
  if (result.device) meta.push(`Device: ${result.device}`)
  if (result.durationSeconds) meta.push(`Duration: ${Math.round(result.durationSeconds)}s`)
  if (meta.length) lines.push(`_${meta.join(' · ')}_`, '')

  lines.push('## Text', '', result.text?.trim() || '', '')

  if (result.chunks?.length) {
    lines.push('## Timestamped', '')
    for (const cue of toCues(result.chunks, result.text)) {
      const start = formatTimestamp(cue.start, { milliseconds: false })
      lines.push(`- **${start}** ${cue.text}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function renderTranscriptToPlainText(result, { timestamps = false } = {}) {
  if (!timestamps) return result.text?.trim() || ''

  return (
    toCues(result.chunks, result.text)
      .map((cue) => `[${formatTimestamp(cue.start, { milliseconds: false })}] ${cue.text}`)
      .join('\n') + '\n'
  )
}