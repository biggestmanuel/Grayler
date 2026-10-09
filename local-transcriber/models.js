/**
 * Model catalog and runtime capability detection.
 *
 * Sizes are approximate download sizes for the recommended dtype on each device.
 * They come from the ONNX files published in each repo and vary by quantization.
 */

export const DEVICES = /** @type {const} */ ({
  AUTO: 'auto',
  WEBGPU: 'webgpu',
  WASM: 'wasm',
})

/**
 * Whisper is an encoder-decoder model, and transformers.js lets each submodule
 * carry its own dtype. The encoder is the accuracy-sensitive half, so it stays
 * at fp32 on WebGPU while the decoder gets quantized.
 */
export const DTYPES = {
  // WebGPU: encoder at full precision, decoder at 4-bit.
  WEBGPU: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  // WASM has no fp16 support, so both halves stay quantized.
  WASM: { encoder_model: 'q8', decoder_model_merged: 'q8' },
}

export const MODELS = [
  {
    id: 'onnx-community/whisper-tiny',
    label: 'Tiny',
    note: 'Fastest, lowest quality. Good for a quick gist on modest hardware.',
    approxBytes: 42_000_000,
    languages: 99,
  },
  {
    id: 'onnx-community/whisper-base',
    label: 'Base',
    note: 'Best default for laptops. Noticeably better than Tiny, still light.',
    approxBytes: 80_000_000,
    languages: 99,
    recommended: true,
  },
  {
    id: 'onnx-community/whisper-small',
    label: 'Small',
    note: 'Clear improvement on names and jargon. Needs patience on CPU.',
    approxBytes: 250_000_000,
    languages: 99,
  },
  {
    id: 'onnx-community/whisper-large-v3-turbo',
    label: 'Large v3 Turbo',
    note: 'Best accuracy. Large download and wants a real GPU to stay usable.',
    approxBytes: 850_000_000,
    languages: 99,
  },
]

export const DEFAULT_MODEL_ID = 'onnx-community/whisper-base'

/** Whisper only accepts these codes; the UI should offer names, not raw codes. */
export const LANGUAGES = [
  { code: null, label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
]

/**
 * Detects what this browser can actually run.
 *
 * @returns {Promise<{webgpu: boolean, webgpuReason: string, crossOriginIsolated: boolean, wasmThreads: number, maxAudioSeconds: number, reason: string}>}
 */
export async function detectCapabilities() {
  const hasWebgpuApi = typeof navigator !== 'undefined' && 'gpu' in navigator

  let webgpu = false
  let webgpuReason = 'WebGPU is not available in this browser.'

  if (hasWebgpuApi) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        webgpu = true
        webgpuReason = ''
      } else {
        webgpuReason = 'WebGPU is present but no GPU adapter was granted.'
      }
    } catch (e) {
      webgpuReason = `WebGPU adapter request failed: ${e.message}`
    }
  }

  // SharedArrayBuffer, which enables multi-threaded WASM, needs cross-origin
  // isolation. Without it transformers.js falls back to a single thread.
  const crossOriginIsolated =
    typeof self !== 'undefined' && self.crossOriginIsolated === true

  const wasmThreads = crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 4) : 1

  return {
    webgpu,
    webgpuReason,
    crossOriginIsolated,
    wasmThreads,
    // Whisper processes 30s windows, so longer audio is chunked. There is no
    // hard model limit, but memory grows with the chunk length only.
    maxAudioSeconds: 60 * 60 * 3,
  }
}

export function findModel(id) {
  return MODELS.find((model) => model.id === id) || null
}

/** Human-readable download estimate for the UI. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

/**
 * Resolves the requested device to a concrete one.
 * @param {'auto'|'webgpu'|'wasm'} requested
 * @param {{webgpu: boolean}} capabilities
 */
export function resolveDevice(requested, capabilities) {
  if (requested === DEVICES.WEBGPU) {
    return capabilities.webgpu ? DEVICES.WEBGPU : null
  }
  if (requested === DEVICES.WASM) return DEVICES.WASM
  return capabilities.webgpu ? DEVICES.WEBGPU : DEVICES.WASM
}

/** Estimates how long transcription will take, used to warn before starting. */
export function estimateDuration({ audioSeconds, modelId, device }) {
  const model = findModel(modelId)
  if (!model || !audioSeconds) return null

  // Rough multipliers: seconds of audio per second of compute, per model tier.
  const tiers = {
    'onnx-community/whisper-tiny': 8,
    'onnx-community/whisper-base': 5,
    'onnx-community/whisper-small': 2.2,
    'onnx-community/whisper-large-v3-turbo': 1.4,
  }

  const base = tiers[modelId] || 3
  const factor = device === DEVICES.WEBGPU ? base : base / 4

  return Math.max(1, Math.round(audioSeconds / factor))
}