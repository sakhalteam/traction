/**
 * Render traction's app icons to PNG with no image dependencies.
 *
 * The icon is a stopwatch: a gradient ring (the brand's green → indigo) with a
 * hand pointing up-right, on the app's own near-black navy. Everything is drawn
 * inside the middle 64% of the canvas so the same art is safe as a `maskable`
 * icon, where Android may crop to a circle of 80% diameter.
 *
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// ---- PNG encoding --------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** RGBA bytes → a PNG buffer (8-bit truecolour+alpha, no interlace). */
function encodePNG(width, height, rgba) {
  const stride = width * 4
  // Each scanline is prefixed with its filter byte; 0 = None.
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- Drawing -------------------------------------------------------------

const BG = [0x0b, 0x11, 0x20]
const GREEN = [0x22, 0xc5, 0x5e]
const INDIGO = [0x63, 0x66, 0xf1]
const WHITE = [0xf5, 0xf9, 0xff]

const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Shortest distance from point p to segment ab — used for the rounded hand. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Colour of the icon at a point, in canvas-relative units (0..1 on both axes).
 * Returns [r, g, b] — the icon is fully opaque, so alpha is handled by the
 * caller only where we deliberately fade.
 */
function sample(u, v) {
  // Base: the app's background, warmed by the same corner glows the UI uses.
  const glowA = Math.max(0, 1 - Math.hypot(u - 0.15, v - 0.0) / 0.9)
  const glowB = Math.max(0, 1 - Math.hypot(u - 1.0, v - 0.1) / 0.85)
  let c = mix(BG, GREEN, glowA * glowA * 0.16)
  c = mix(c, INDIGO, glowB * glowB * 0.2)

  const cx = 0.5
  const cy = 0.5
  const d = Math.hypot(u - cx, v - cy)

  // Ring — gradient runs left→right, matching the `.brand` text gradient.
  const rOuter = 0.32
  const rInner = 0.242
  if (d <= rOuter && d >= rInner) {
    return mix(GREEN, INDIGO, Math.min(1, Math.max(0, (u - 0.18) / 0.64)))
  }

  // Hand: from the centre up and to the right, like a stopwatch at ~10 seconds.
  const angle = -Math.PI / 3 // up-right
  const handLen = 0.185
  const hx = cx + Math.cos(angle) * handLen
  const hy = cy + Math.sin(angle) * handLen
  if (distToSegment(u, v, cx, cy, hx, hy) <= 0.031) return WHITE

  return c
}

/** Render at 4× and box-filter down, so every edge lands antialiased. */
function render(size) {
  const SS = 4
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      rgba[i] = Math.round(r / n)
      rgba[i + 1] = Math.round(g / n)
      rgba[i + 2] = Math.round(b / n)
      rgba[i + 3] = 255
    }
  }
  return encodePNG(size, size, rgba)
}

mkdirSync(OUT, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]) {
  writeFileSync(join(OUT, name), render(size))
  console.log(`wrote public/${name} (${size}×${size})`)
}
