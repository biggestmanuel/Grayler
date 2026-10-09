# local-transcriber

On-device speech-to-text for the browser. Whisper runs locally through
[transformers.js](https://github.com/huggingface/transformers.js), so audio is
never uploaded anywhere.

This folder is self-contained. Copy it into another project and nothing outside
it needs to change.

## Requirements

- `@huggingface/transformers` (peer dependency, `>=3`)
- A browser with either WebGPU (Chrome/Edge 113+) or WASM. WASM works
  everywhere but is much slower.
- Network access on first run, to download the model. After that it is cached
  by the browser Cache API.

## Install

```bash
npm i @huggingface/transformers
```

Then copy `local-transcriber/` into your source tree.

## Use it

### Promise API

```js
import { createTranscriber } from './local-transcriber/index.js'

const transcriber = await createTranscriber({
  modelId: 'onnx-community/whisper-base',
  device: 'auto',
  onProgress: (update) => console.log(update.status, update.progress),
})

const result = await transcriber.transcribe(file, {
  language: 'en',      // null auto-detects
  task: 'transcribe',  // or 'translate' to render speech into English
  timestamps: true,
})

console.log(result.text)
console.log(result.chunks) // [{ text, start, end }]

transcriber.dispose()
```

### React

```jsx
import { useLocalTranscriber } from './local-transcriber/react.js'
import './local-transcriber/styles.css'

function Recorder() {
  const { state, progress, result, error, transcribe, cancel, reset, capabilities } =
    useLocalTranscriber({ modelId: 'onnx-community/whisper-base' })

  if (state === 'transcribing') return <button onClick={cancel}>Cancel</button>

  return (
    <>
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => transcribe(e.target.files[0])}
      />
      {progress.status === 'download' && <progress value={progress.progress} />}
      {error && <p>{error}</p>}
      {result && <p>{result.text}</p>}
    </>
  )
}
```

`useLocalTranscriber` returns `state` (`idle`, `loading-model`, `ready`,
`decoding`, `transcribing`, `done`, `error`), `isBusy`, `estimateFor(file)` for
a pre-flight time estimate, and `preload()` to warm the model early.

### No framework

```js
import { mountTranscriber } from './local-transcriber/vanilla.js'
import './local-transcriber/styles.css'

const ui = mountTranscriber(document.querySelector('#app'), {
  modelId: 'onnx-community/whisper-base',
})

ui.on('result', ({ text }) => console.log(text))
```

## Models

| Model | Download | Notes |
| --- | --- | --- |
| `onnx-community/whisper-tiny` | ~42 MB | Fastest, roughest. Fine for a quick gist. |
| `onnx-community/whisper-base` | ~80 MB | Best default on a laptop. |
| `onnx-community/whisper-small` | ~250 MB | Noticeably better on names and jargon. |
| `onnx-community/whisper-large-v3-turbo` | ~850 MB | Best accuracy, wants a real GPU. |

All are multilingual (99 languages) and can translate to English with
`task: 'translate'`.

## How it works

Audio is decoded with the Web Audio API, downmixed to mono, and resampled to
16 kHz through an `OfflineAudioContext` rather than by dropping samples, which
would alias. Quiet leading and trailing audio is trimmed by RMS window.

Inference runs in a Web Worker, and the sample buffer is transferred to it so
the audio is not copied. Whisper processes 30-second windows, so longer inputs
are split at 30s with 5s overlap and each window's timestamps are shifted back
onto the original timeline.

## Precision

Whisper's encoder is unusually sensitive to quantization. `DTYPES.WEBGPU` keeps
the encoder at `fp32` and quantizes only the decoder:

```js
DTYPES.WEBGPU = { encoder_model: 'fp32', decoder_model_merged: 'q4' }
DTYPES.WASM   = { encoder_model: 'q8',   decoder_model_merged: 'q8' }
```

Forcing `q4` on the encoder, which is what passing a single `dtype: 'q4'` does,
measurably degrades accuracy. If you override `dtype`, keep the encoder high.

## Cross-origin isolation

Multi-threaded WASM needs `SharedArrayBuffer`, which requires the page to send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. Without those headers WASM runs
single-threaded and is roughly 4x slower. WebGPU is unaffected.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Exports

`createTranscriber`, `useLocalTranscriber`, `mountTranscriber`,
`renderTranscriptToSrt`, `renderTranscriptToVtt`,
`renderTranscriptToMarkdown`, `renderTranscriptToPlainText`, plus the audio
helpers (`decodeAudioFile`, `toWhisperInput`, `trimSilence`, `chunkAudio`,
`isSilent`), model metadata (`MODELS`, `LANGUAGES`, `detectCapabilities`,
`estimateDuration`, `formatBytes`), and `AudioError`.

## Limits worth knowing

- **No speaker labels.** Whisper returns flat text. Diarization is a separate
  model and is not included, so you get "who said what" nowhere.
- **Accuracy on overlapping speech is poor**, same as upstream Whisper.
- **Cancellation is best-effort**, checked between windows. A single window
  already decoding cannot be interrupted.
- **The first run is slow**, since the model downloads before anything
  transcribes. Cache it or preload.

## Testing

The audio helpers, windowing, formatters, and device resolution are covered by
Grayler's `node:test` suite. Model inference itself needs a browser and a
multi-megabyte download, so it is not covered by unit tests.