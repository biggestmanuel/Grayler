/**
 * Framework-free UI for local-transcriber.
 *
 *   import { mountTranscriber } from 'local-transcriber/vanilla'
 *   import 'local-transcriber/styles.css'
 *
 *   const ui = mountTranscriber(document.querySelector('#app'))
 *   ui.on('result', ({ text }) => console.log(text))
 *
 * Renders with plain DOM calls, so it drops into anything without a build step
 * or a framework. All text is set through textContent, never innerHTML, so a
 * transcript containing markup cannot inject nodes.
 */

import { createTranscriber } from './transcriber.js'
import { MODELS, LANGUAGES, DEVICES, detectCapabilities, formatBytes } from './models.js'
import { renderTranscriptToPlainText, renderTranscriptToSrt, renderTranscriptToVtt, renderTranscriptToMarkdown } from './format.js'

const ACCEPTED_AUDIO = 'audio/*,.wav,.mp3,.m4a,.ogg,.webm,.mp4,.aac,.flac,.oga'

const STATE_LABELS = {
  idle: 'Ready',
  'loading-model': 'Loading model',
  ready: 'Model ready',
  decoding: 'Decoding audio',
  transcribing: 'Transcribing',
  done: 'Done',
  error: 'Failed',
}

/**
 * @param {HTMLElement} root
 * @param {object} [options] Passed through to createTranscriber.
 * @returns {{destroy: () => void, on: (event: string, handler: Function) => void, transcribe: (file: File) => Promise<object|null>}}
 */
export function mountTranscriber(root, options = {}) {
  const listeners = new Map()

  function emit(event, payload) {
    for (const handler of listeners.get(event) || []) handler(payload)
  }

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(handler)
    return () => listeners.get(event).delete(handler)
  }

  // ------------------------------- Elements -------------------------------

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  const container = el('div', 'ltx')

  const dropzone = el('div', 'ltx-dropzone')
  dropzone.append(
    el('p', 'ltx-dropzone-title', 'Drop audio here'),
    el('p', 'ltx-dropzone-hint', 'wav, mp3, m4a, ogg, webm, mp4, flac — processed on this device')
  )

  const fileInput = el('input', 'ltx-visually-hidden')
  fileInput.type = 'file'
  fileInput.accept = ACCEPTED_AUDIO
  fileInput.setAttribute('aria-label', 'Choose an audio file')

  const fileLabel = el('p', 'ltx-file')

  const chooseButton = el('button', 'ltx-button ltx-button-secondary', 'Choose file')
  chooseButton.type = 'button'
  chooseButton.addEventListener('click', () => fileInput.click())

  dropzone.append(fileInput, fileLabel, chooseButton)

  // Model / device / language controls.
  const controls = el('div', 'ltx-controls')

  const modelField = el('label', 'ltx-field')
  modelField.append(el('span', null, 'Model'))
  const modelSelect = el('select')
  for (const model of MODELS) {
    const option = el('option', null, `${model.label} · ~${formatBytes(model.approxBytes)}`)
    option.value = model.id
    if (model.id === options.modelId) option.selected = true
    modelSelect.append(option)
  }
  const modelHint = el('span', 'ltx-field-hint')
  modelField.append(modelSelect, modelHint)

  const deviceField = el('label', 'ltx-field')
  deviceField.append(el('span', null, 'Device'))
  const deviceSelect = el('select')
  const deviceAuto = el('option', null, 'Auto')
  deviceAuto.value = DEVICES.AUTO
  const deviceWebgpu = el('option', null, 'WebGPU (GPU)')
  deviceWebgpu.value = DEVICES.WEBGPU
  const deviceWasm = el('option', null, 'WASM (CPU)')
  deviceWasm.value = DEVICES.WASM
  deviceSelect.append(deviceAuto, deviceWebgpu, deviceWasm)
  const deviceHint = el('span', 'ltx-field-hint')
  deviceField.append(deviceSelect, deviceHint)

  const languageField = el('label', 'ltx-field')
  languageField.append(el('span', null, 'Language'))
  const languageSelect = el('select')
  for (const language of LANGUAGES) {
    const option = el('option', null, language.label)
    option.value = language.code || ''
    languageSelect.append(option)
  }
  languageField.append(languageSelect)

  controls.append(modelField, deviceField, languageField)

  const actions = el('div', 'ltx-actions')
  const transcribeButton = el('button', 'ltx-button ltx-button-primary', 'Transcribe')
  transcribeButton.type = 'button'
  const cancelButton = el('button', 'ltx-button ltx-button-secondary', 'Cancel')
  cancelButton.type = 'button'
  cancelButton.disabled = true
  actions.append(transcribeButton, cancelButton)

  const status = el('div', 'ltx-status')
  const spinner = el('span', 'ltx-spinner')
  const statusText = el('span', null, 'Ready')
  status.append(spinner, statusText)

  const progressTrack = el('div', 'ltx-progress')
  const progressBar = el('div', 'ltx-progress-bar')
  progressBar.style.width = '0%'
  progressTrack.append(progressBar)

  const errorBox = el('div', 'ltx-error')
  errorBox.hidden = true

  const privacy = el(
    'p',
    'ltx-notice',
    'Audio is decoded and transcribed in this browser. Nothing is uploaded.'
  )

  const output = el('div', 'ltx-output')
  output.hidden = true

  container.append(dropzone, controls, actions, status, progressTrack, errorBox, privacy, output)
  root.append(container)

  // --------------------------------- State ---------------------------------

  let transcriber = null
  let capabilities = null
  let selectedFile = null
  let destroyed = false

  function setStatus(label, { showSpinner = true } = {}) {
    statusText.textContent = label
    spinner.hidden = !showSpinner
  }

  function setProgress(percent, indeterminate) {
    progressBar.dataset.indeterminate = indeterminate ? 'true' : 'false'
    progressBar.style.width = indeterminate ? '' : `${Math.max(0, Math.min(100, percent))}%`
  }

  function showError(message) {
    if (!message) {
      errorBox.hidden = true
      errorBox.textContent = ''
      return
    }
    errorBox.hidden = false
    errorBox.textContent = message
  }

  function currentOptions() {
    return {
      modelId: modelSelect.value,
      device: deviceSelect.value,
      language: languageSelect.value || null,
    }
  }

  async function ensureTranscriber() {
    if (transcriber && transcriber.modelId === modelSelect.value) return transcriber

    if (transcriber) {
      transcriber.dispose()
      transcriber = null
    }

    setStatus('Loading model', { showSpinner: true })
    showError('')

    try {
      transcriber = await createTranscriber({
        ...options,
        ...currentOptions(),
        onProgress: (update) => {
          if (update.status === 'download' && update.total) {
            const percent = (update.loaded / update.total) * 100
            setProgress(percent, false)
            setStatus(`Downloading ${update.file} · ${Math.round(percent)}%`, { showSpinner: false })
          } else if (update.status === 'ready') {
            setProgress(0, false)
            setStatus('Model ready')
          } else if (update.status === 'transcribe') {
            setProgress(update.progress || 0, false)
            const chunk = update.totalChunks ? ` · window ${update.chunk}/${update.totalChunks}` : ''
            setStatus(`Transcribing${chunk}`, { showSpinner: false })
          }
        },
      })
      return transcriber
    } catch (e) {
      showError(e.message)
      setStatus('Failed')
      return null
    }
  }

  function renderOutput(result) {
    output.hidden = false
    output.textContent = ''

    const header = el('div', 'ltx-output-header')
    header.append(el('h4', null, 'Transcript'))

    const badge = el('span', 'ltx-badge', result.device === 'webgpu' ? 'WebGPU' : 'WASM')
    header.append(badge)

    const copyButton = el('button', 'ltx-button ltx-button-secondary', 'Copy')
    copyButton.type = 'button'
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(result.text)
        copyButton.textContent = 'Copied'
        setTimeout(() => {
          copyButton.textContent = 'Copy'
        }, 1500)
      } catch {
        copyButton.textContent = 'Copy failed'
      }
    })
    header.append(copyButton)

    const download = el('button', 'ltx-button ltx-button-secondary', 'Download')
    download.type = 'button'
    download.addEventListener('click', () => {
      const blob = new Blob([renderTranscriptToMarkdown(result)], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const link = el('a')
      link.href = url
      link.download = 'transcript.md'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    header.append(download)

    const meta = el('div', 'ltx-meta')
    meta.append(el('span', null, result.model || modelSelect.value))
    if (result.durationSeconds) meta.append(el('span', null, `${Math.round(result.durationSeconds)}s audio`))
    header.append(meta)

    output.append(header, el('p', 'ltx-text', result.text || '(no speech detected)'))

    if (result.chunks?.length) {
      const list = el('div', 'ltx-timestamps')
      for (const cue of result.chunks) {
        const row = el('p')
        const minutes = Math.floor(cue.start / 60)
        const seconds = Math.floor(cue.start % 60)
        row.append(
          el('span', 'ltx-timestamp', `${minutes}:${String(seconds).padStart(2, '0')}`),
          el('span', null, cue.text)
        )
        list.append(row)
      }
      output.append(list)
    }
  }

  async function run() {
    if (!selectedFile || destroyed) return null

    transcribeButton.disabled = true
    cancelButton.disabled = false
    output.hidden = true
    showError('')

    try {
      const engine = await ensureTranscriber()
      if (!engine || destroyed) return null

      setStatus('Decoding audio')
      setProgress(0, false)

      const result = await engine.transcribe(selectedFile, {
        language: languageSelect.value || null,
        task: 'transcribe',
        timestamps: true,
      })

      if (destroyed) return null

      setProgress(100, false)
      setStatus(STATE_LABELS.done, { showSpinner: false })
      renderOutput(result)
      emit('result', result)
      return result
    } catch (e) {
      if (destroyed) return null
      if (e.name === 'AbortError') {
        setStatus('Cancelled', { showSpinner: false })
      } else {
        showError(e.message)
        setStatus(STATE_LABELS.error, { showSpinner: false })
      }
      emit('error', e)
      return null
    } finally {
      transcribeButton.disabled = !selectedFile
      cancelButton.disabled = true
    }
  }

  // -------------------------------- Wiring ---------------------------------

  function acceptFile(file) {
    if (!file) return
    selectedFile = file
    fileLabel.textContent = `${file.name} · ${formatBytes(file.size)}`
    transcribeButton.disabled = false
    emit('file', file)
  }

  fileInput.addEventListener('change', () => acceptFile(fileInput.files?.[0]))

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropzone.dataset.dragging = 'true'
  })

  dropzone.addEventListener('dragleave', () => {
    dropzone.dataset.dragging = 'false'
  })

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropzone.dataset.dragging = 'false'
    acceptFile(e.dataTransfer?.files?.[0])
  })

  transcribeButton.addEventListener('click', run)

  cancelButton.addEventListener('click', () => {
    transcriber?.cancel()
    cancelButton.disabled = true
    transcribeButton.disabled = !selectedFile
    setStatus('Cancelled', { showSpinner: false })
  })

  // Changing the model or device invalidates the loaded pipeline.
  for (const select of [modelSelect, deviceSelect]) {
    select.addEventListener('change', () => {
      const model = MODELS.find((m) => m.id === modelSelect.value)
      modelHint.textContent = model ? model.note : ''
    })
  }

  detectCapabilities().then((caps) => {
    if (destroyed) return
    capabilities = caps

    if (!caps.webgpu) {
      deviceWebgpu.disabled = true
      deviceSelect.value = DEVICES.WASM
      deviceHint.textContent = caps.webgpuReason
    } else {
      deviceHint.textContent = caps.crossOriginIsolated
        ? `WebGPU ready · ${caps.wasmThreads} WASM threads`
        : 'WebGPU ready · WASM limited to 1 thread (no cross-origin isolation)'
    }

    const model = MODELS.find((m) => m.id === modelSelect.value)
    modelHint.textContent = model ? model.note : ''

    emit('capabilities', caps)
  })

  setProgress(0, false)

  return {
    on,
    transcribe: run,
    /** Exposes the renderers so hosts can build their own download menu. */
    formats: {
      text: renderTranscriptToPlainText,
      srt: renderTranscriptToSrt,
      vtt: renderTranscriptToVtt,
      markdown: renderTranscriptToMarkdown,
    },
    get capabilities() {
      return capabilities
    },
    destroy() {
      destroyed = true
      transcriber?.dispose()
      transcriber = null
      listeners.clear()
      container.remove()
    },
  }
}

export default mountTranscriber