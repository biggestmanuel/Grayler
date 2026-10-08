// Renders a summary result as Markdown for clipboard or file download.

export function resultToMarkdown(result, { sourceLabel, createdAt } = {}) {
  const lines = []

  lines.push('# Meeting summary')
  lines.push('')
  if (createdAt) lines.push(`_Generated ${formatStamp(createdAt)}_`)
  if (sourceLabel) lines.push(`_Source: ${sourceLabel}_`)
  if (createdAt || sourceLabel) lines.push('')

  if (result.summary) {
    lines.push('## Summary', '', result.summary, '')
  }

  if (result.action_items?.length) {
    lines.push('## Action items', '')
    for (const item of result.action_items) lines.push(`- [ ] ${item}`)
    lines.push('')
  }

  if (result.decisions?.length) {
    lines.push('## Decisions', '')
    for (const decision of result.decisions) lines.push(`- ${decision}`)
    lines.push('')
  }

  if (result.open_questions?.length) {
    lines.push('## Open questions', '')
    for (const question of result.open_questions) lines.push(`- ${question}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

export function resultToPlainText(result) {
  return [
    'MEETING SUMMARY',
    '',
    result.summary || '',
    '',
    'ACTION ITEMS',
    ...(result.action_items || []).map((item) => `  - ${item}`),
    '',
    'DECISIONS',
    ...(result.decisions || []).map((decision) => `  - ${decision}`),
  ].join('\n')
}

function formatStamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}