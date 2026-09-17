/**
 * Render traction's app icons to PNG with no image dependencies.
 *
 * The icon is a stopwatch drawn in adhdo's idiom, so the two sit together on a
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

/* Colours. The background and its two washes are adhdo's, to the byte — these
 * apps sit next to each other on a home screen and should read as a set. The
 * mark keeps traction's own green → indigo, so the family is the backdrop and
 * the hue is the identity. */
const BG = [0x0a, 0x0a, 0x1a]
const GREEN = [0x22, 0xc5, 0x5e]
const INDIGO = [0x63, 0x66, 0xf1]
const WHITE = [0xff, 0xff, 0xff]

const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const clamp01 = v => Math.max(0, Math.min(1, v))

/** Shortest distance from point p to segment ab — used for the rounded hand. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Paint one shape the way adhdo paints a glob: a halo that falls off as the
 * square of the distance, then a core with a soft edge rather than a hard one.
 * `d` is a signed distance — negative inside the shape, in canvas units.
 */
function paint(c, d, color, { soft, glow, glowStrength = 0.4 }) {
  let out = c
  if (d < glow) {
    const halo = 1 - Math.max(0, d) / glow
    out = mix(out, color, halo * halo * glowStrength)
  }
  const edge = clamp01(-d / soft)
  if (edge > 0) out = mix(out, color, edge)
  return out
}

// Stopwatch geometry, all inside the middle 64% so the art survives a
// `maskable` crop to a circle of 80% diameter.
const CX = 0.5
const CY = 0.515
const RING = 0.278 // centreline radius
const RING_HALF = 0.036 // half thickness
const HAND_ANGLE = -Math.PI / 3 // up-right, a stopwatch at about ten seconds
const HAND_LEN = 0.2
const HX = CX + Math.cos(HAND_ANGLE) * HAND_LEN
const HY = CY + Math.sin(HAND_ANGLE) * HAND_LEN

/** Colour of the icon at a point, in canvas-relative units (0..1 both axes). */
function sample(u, v) {
  // Nebula: adhdo's two washes, re-tinted to traction's pair.
  const washA = Math.max(0, 1 - Math.hypot((u - 0.2) / 0.9, (v - 0.0) / 0.55))
  const washB = Math.max(0, 1 - Math.hypot((u - 0.9) / 0.85, (v - 1.0) / 0.55))
  let c = mix(BG, INDIGO, washA * washA * 0.2)
  c = mix(c, GREEN, washB * washB * 0.14)

  // The gradient the whole case is cut from — ring and crown share it, so the
  // crown reads as part of the watch rather than a violet pin above it.
  const caseColor = mix(GREEN, INDIGO, clamp01((u - 0.18) / 0.64))

  // Crown, drawn first and started *inside* the ring so the ring caps it.
  const stem = distToSegment(u, v, CX, CY - RING + 0.01, CX, CY - RING - 0.062) - 0.032
  c = paint(c, stem, caseColor, { soft: 0.018, glow: 0.055, glowStrength: 0.28 })

  // Ring. The gradient runs left → right, matching the `.brand` text.
  const ring = Math.abs(Math.hypot(u - CX, v - CY) - RING) - RING_HALF
  c = paint(c, ring, caseColor, { soft: 0.02, glow: 0.075, glowStrength: 0.34 })

  // Hand, then the pivot over it so the join is a single soft blob.
  const hand = distToSegment(u, v, CX, CY, HX, HY) - 0.026
  c = paint(c, hand, WHITE, { soft: 0.016, glow: 0.05, glowStrength: 0.22 })

  const pivot = Math.hypot(u - CX, v - CY) - 0.052
  c = paint(c, pivot, WHITE, { soft: 0.02, glow: 0.07, glowStrength: 0.26 })
  // Inner highlight, offset up-left, to give the pivot a little volume.
  const hi = Math.hypot(u - (CX - 0.016), v - (CY - 0.017))
  if (hi < 0.03) c = mix(c, WHITE, (1 - hi / 0.03) * 0.5)

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
