/**
 * Regenerates the static image assets from the full-size source logo.
 *
 * Runs with plain Node (zlib only) so the repo does not need a native image
 * dependency just to produce two PNGs.
 *
 *   node scripts/optimize-assets.mjs
 *
 * Produces:
 *   public/logo.png  256x256  app mark + favicon
 *   public/og.png   1200x630  Open Graph / Twitter card image
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'source-assets', 'logo-full.png')
const LOGO_OUT = join(root, 'public', 'logo.png')
const OG_OUT = join(root, 'public', 'og.png')

const LOGO_SIZE = 256
const OG_WIDTH = 1200
const OG_HEIGHT = 630

/* ----------------------------- PNG decoding ----------------------------- */

function readChunks(buffer) {
  const chunks = []
  let offset = 8 // skip signature

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
  }

  return chunks
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Decodes an 8-bit RGBA PNG into a flat pixel buffer. */
function decodeRgba(buffer) {
  const chunks = readChunks(buffer)
  const header = chunks.find((chunk) => chunk.type === 'IHDR')
  if (!header) throw new Error('Not a PNG: missing IHDR')

  const width = header.data.readUInt32BE(0)
  const height = header.data.readUInt32BE(4)
  const bitDepth = header.data[8]
  const colorType = header.data[9]

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Only 8-bit RGBA PNGs are supported (got depth ${bitDepth}, color type ${colorType})`)
  }
  if (!chunks.some((chunk) => chunk.type === 'IDAT')) throw new Error('Not a PNG: missing IDAT')

  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)

  let previous = Buffer.alloc(stride)
  let pos = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride

    const out = pixels.subarray(y * stride, (y + 1) * stride)

    for (let x = 0; x < stride; x++) {
      const rawByte = line[x]
      const a = x >= 4 ? out[x - 4] : 0
      const b = previous[x]
      const c = x >= 4 ? previous[x - 4] : 0

      switch (filter) {
        case 0: out[x] = rawByte; break
        case 1: out[x] = (rawByte + a) & 0xff; break
        case 2: out[x] = (rawByte + b) & 0xff; break
        case 3: out[x] = (rawByte + ((a + b) >> 1)) & 0xff; break
        case 4: out[x] = (rawByte + paeth(a, b, c)) & 0xff; break
        default: throw new Error(`Unknown PNG filter type ${filter}`)
      }
    }

    previous = out
  }

  return { width, height, pixels }
}

/* ----------------------------- PNG encoding ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)

  return Buffer.concat([length, typed, crc])
}

function encodeRgba({ width, height, pixels }) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------ Resampling ------------------------------ */

/** Box-filter downscale, with alpha-weighted color averaging to avoid halos. */
function resize(image, targetWidth, targetHeight) {
  const { width, height, pixels } = image
  const out = Buffer.alloc(targetWidth * targetHeight * 4)

  const xRatio = width / targetWidth
  const yRatio = height / targetHeight

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil((y + 1) * yRatio)))

    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil((x + 1) * xRatio)))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let weight = 0

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4
          const alpha = pixels[i + 3]

          // Transparent pixels contribute color without pulling the edge inward.
          r += pixels[i] * alpha
          g += pixels[i + 1] * alpha
          b += pixels[i + 2] * alpha
          a += alpha
          weight += alpha
        }
      }

      const o = (y * targetWidth + x) * 4
      out[o] = weight ? Math.round(r / weight) : 0
      out[o + 1] = weight ? Math.round(g / weight) : 0
      out[o + 2] = weight ? Math.round(b / weight) : 0
      out[o + 3] = weight ? Math.round(a / ((x1 - x0) * (y1 - y0))) : 0
    }
  }

  return { width: targetWidth, height: targetHeight, pixels: out }
}

/** Composites `overlay` centered on `canvas` with source-over alpha. */
function composite(canvas, overlay) {
  const { width: cw, height: ch, pixels: canvasPixels } = canvas
  const { width: ow, height: oh, pixels: overlayPixels } = overlay
  const x0 = Math.round((cw - ow) / 2)
  const y0 = Math.round((ch - oh) / 2)

  for (let y = 0; y < oh; y++) {
    const cy = y + y0
    if (cy < 0 || cy >= ch) continue

    for (let x = 0; x < ow; x++) {
      const cx = x + x0
      if (cx < 0 || cx >= cw) continue

      const i = (y * ow + x) * 4
      const o = (cy * cw + cx) * 4

      const alpha = overlayPixels[i + 3] / 255
      if (alpha === 0) continue

      for (let c = 0; c < 3; c++) {
        canvasPixels[o + c] = Math.round(overlayPixels[i + c] * alpha + canvasPixels[o + c] * (1 - alpha))
      }
      canvasPixels[o + 3] = Math.max(canvasPixels[o + 3], overlayPixels[i + 3])
    }
  }
}

/* ------------------------------- OG image ------------------------------- */

function hex(value) {
  const n = Number.parseInt(value.replace('#', ''), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function createOgCanvas() {
  const bg = hex('#0a0c16')
  const glow = hex('#7067ff')
  const pixels = Buffer.alloc(OG_WIDTH * OG_HEIGHT * 4)

  for (let y = 0; y < OG_HEIGHT; y++) {
    for (let x = 0; x < OG_WIDTH; x++) {
      const o = (y * OG_WIDTH + x) * 4

      // Vertical falloff from the top glow to the deep base color.
      const t = Math.min(1, y / OG_HEIGHT)
      const radial = Math.max(0, 1 - Math.hypot((x - OG_WIDTH / 2) / (OG_WIDTH * 0.62), (y - 0) / (OG_HEIGHT * 0.9)))

      for (let c = 0; c < 3; c++) {
        pixels[o + c] = Math.round(bg[c] + (glow[c] - bg[c]) * radial * (1 - t) * 0.35)
      }
      pixels[o + 3] = 255
    }
  }

  return { width: OG_WIDTH, height: OG_HEIGHT, pixels }
}

/* --------------------------------- Main --------------------------------- */

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Missing source image: ${SOURCE}`)
    console.error('Restore the original full-size logo to source-assets/logo-full.png first.')
    process.exit(1)
  }

  const source = decodeRgba(readFileSync(SOURCE))
  console.log(`Decoded source: ${source.width}x${source.height}`)

  const logo = resize(source, LOGO_SIZE, LOGO_SIZE)
  writeFileSync(LOGO_OUT, encodeRgba(logo))

  const og = createOgCanvas()
  composite(og, resize(source, 320, 320))
  writeFileSync(OG_OUT, encodeRgba(og))

  const report = (label, path) => {
    const bytes = readFileSync(path).length
    console.log(`${label.padEnd(18)} ${(bytes / 1024).toFixed(1)} KB  ${path.replace(root + '\\', '')}`)
  }

  report('logo.png', LOGO_OUT)
  report('og.png', OG_OUT)
}

main()