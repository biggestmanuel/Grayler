// Local-only history of saved summaries. Nothing leaves the browser; this is a
// convenience layer, not a backup.

const KEY = 'grayler-history'
const MAX_ENTRIES = 50

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

export function loadHistory() {
  if (typeof localStorage === 'undefined') return []
  return safeParse(localStorage.getItem(KEY) || '[]')
}

function persist(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
    return true
  } catch (e) {
    // Quota exceeded or storage disabled (private mode).
    console.warn('[grayler] could not save history:', e.message)
    return false
  }
}

export function saveEntry(entry) {
  const entries = loadHistory().filter((item) => item.id !== entry.id)
  entries.unshift(entry)
  return persist(entries)
}

export function deleteEntry(id) {
  return persist(loadHistory().filter((item) => item.id !== id))
}

export function clearHistory() {
  if (typeof localStorage === 'undefined') return true
  try {
    localStorage.removeItem(KEY)
    return true
  } catch (_) {
    return false
  }
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}