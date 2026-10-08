// Audio helpers: File -> base64 payloads and an optional in-browser recorder.

export const ACCEPTED_AUDIO = 'audio/*,.mp3,.m4a,.wav,.ogg,.webm,.mp4,.flac,.mpeg,.mpga'

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** Picks the best container the browser can actually record. */
function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || ''
}

export function isRecordingSupported() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

/**
 * Records microphone audio and resolves to a Blob when stopped.
 * @param {(seconds: number) => void} onTick
 */
export function startRecording(onTick) {
  return navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((stream) => {
      const mimeType = pickRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks = []
      const startedAt = Date.now()

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data)
      }

      const timer = setInterval(() => onTick(Math.round((Date.now() - startedAt) / 1000)), 250)
      recorder.start(1000)

      const stop = () =>
        new Promise((resolve) => {
          recorder.onstop = () => {
            clearInterval(timer)
            stream.getTracks().forEach((track) => track.stop())
            resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
          }
          if (recorder.state !== 'inactive') recorder.stop()
          else resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        })

      return { recorder, stop }
    })
}

export function blobToFile(blob, filename) {
  const extension = (blob.type.split('/')[1] || 'webm').split(';')[0]
  return new File([blob], `${filename}.${extension}`, { type: blob.type })
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}