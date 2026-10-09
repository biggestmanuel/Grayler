/**
 * React bindings for local-transcriber.
 *
 *   import { useLocalTranscriber } from 'local-transcriber/react'
 *   import 'local-transcriber/styles.css'
 *
 *   const { state, progress, transcribe, cancel, reset, capabilities } = useLocalTranscriber()
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createTranscriber } from './transcriber.js'
import { detectCapabilities, estimateDuration, formatBytes } from './models.js'

const IDLE_STATES = ['idle', 'loading-model', 'ready', 'decoding', 'transcribing', 'done', 'error']

/**
 * @param {object} [options] Same shape as createTranscriber, plus:
 * @param {boolean} [options.preload] Load the model as soon as the hook mounts.
 * @param {string} [options.modelId]
 * @param {'auto'|'webgpu'|'wasm'} [options.device]
 */
export function useLocalTranscriber(options = {}) {
  const [state, setState] = useState('idle')
  const [progress, setProgress] = useState({ status: 'idle', progress: 0 })
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [capabilities, setCapabilities] = useState(null)
  const [estimate, setEstimate] = useState(null)

  const transcriberRef = useRef(null)
  const mountedRef = useRef(true)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      transcriberRef.current?.dispose()
      transcriberRef.current = null
    }
  }, [])

  // Capability detection is cheap and gates everything else.
  useEffect(() => {
    let active = true
    detectCapabilities().then((caps) => {
      if (active) setCapabilities(caps)
    })
    return () => {
      active = false
    }
  }, [])

  const ensureTranscriber = useCallback(async () => {
    if (transcriberRef.current) return transcriberRef.current

    if (!mountedRef.current) return null

    setState('loading-model')
    setProgress({ status: 'load', progress: 0 })
    setError(null)

    try {
      const transcriber = await createTranscriber({
        ...optionsRef.current,
        onProgress: (update) => {
          if (!mountedRef.current) return
          setProgress(update)
        },
      })

      if (!mountedRef.current) {
        transcriber.dispose()
        return null
      }

      transcriberRef.current = transcriber
      setState('ready')
      return transcriber
    } catch (e) {
      if (mountedRef.current) {
        setError(e.message)
        setState('error')
      }
      return null
    }
  }, [])

  useEffect(() => {
    if (options.preload) ensureTranscriber()
  }, [options.preload, ensureTranscriber])

  const transcribe = useCallback(
    async (file, transcribeOptions = {}) => {
      if (!file) return null

      try {
        const transcriber = await ensureTranscriber()
        if (!transcriber) return null

        setState('decoding')
        setResult(null)

        const outcome = await transcriber.transcribe(file, transcribeOptions)

        if (!mountedRef.current) return null

        setResult({ ...outcome, model: transcriber.modelId })
        setState('done')
        setProgress({ status: 'done', progress: 100 })
        return outcome
      } catch (e) {
        if (!mountedRef.current) return null
        // A cancel is a user action, not a failure.
        if (e.name === 'AbortError') {
          setState('ready')
          return null
        }
        setError(e.message)
        setState('error')
        return null
      }
    },
    [ensureTranscriber]
  )

  const cancel = useCallback(() => {
    transcriberRef.current?.cancel()
    setState('ready')
    setProgress({ status: 'cancelled', progress: 0 })
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
    setProgress({ status: 'idle', progress: 0 })
    setState(transcriberRef.current ? 'ready' : 'idle')
  }, [])

  const dispose = useCallback(() => {
    transcriberRef.current?.dispose()
    transcriberRef.current = null
    setState('idle')
  }, [])

  /** Estimated seconds for a given file, shown before a long job starts. */
  const estimateFor = useCallback(
    (file, device = options.device || 'auto') => {
      if (!file || !capabilities) return null
      const resolved = device === 'auto' ? (capabilities.webgpu ? 'webgpu' : 'wasm') : device
      const seconds = estimateDuration({
        audioSeconds: file.size / 32000, // ~16 kHz 16-bit mono approximation
        modelId: optionsRef.current.modelId,
        device: resolved,
      })
      setEstimate(seconds)
      return seconds
    },
    [capabilities, options.device]
  )

  return {
    state,
    progress,
    result,
    error,
    capabilities,
    estimate,
    transcribe,
    cancel,
    reset,
    dispose,
    preload: ensureTranscriber,
    estimateFor,
    formatBytes,
    isBusy: state === 'loading-model' || state === 'decoding' || state === 'transcribing',
    isSupported: IDLE_STATES.includes(state),
  }
}

export default useLocalTranscriber