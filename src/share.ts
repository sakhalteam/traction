/**
 * Turning an invoice into something you can text someone.
 *
 * The invoice is live HTML, so there is nothing to attach until we make it. It
 * gets rasterised to a PNG rather than a PDF because the destination is almost
 * always a text message, where an image previews inline and a PDF arrives as a
 * file the client has to decide to open. It is rendered at LETTER width no
 * matter what device is holding the phone — the copy a client receives must not
 * change shape depending on which screen happened to produce it.
 *
 * Rasterising is done with an SVG <foreignObject>, which needs no dependency
 * but is strict about self-containment: it cannot reach the network while it
 * renders. Every stylesheet is inlined, and every <img> is fetched and turned
 * into a data: URI first, or the watermark and logo silently vanish.
 */

/** 8.5in at 96dpi — the width the printed sheet is designed around. */
const LETTER_WIDTH = 816
/** Rasterise at 2x so the result stays sharp when a client pinches to zoom. */
const SCALE = 2

export class ShareError extends Error {}

/** Can this browser hand an actual file to the OS share sheet? */
export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
}

/** Every same-origin CSS rule on the page, as one string. */
function collectCss(): string {
  let out = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out += rule.cssText + '\n'
    } catch {
      // A cross-origin sheet throws on cssRules. We have none, but a browser
      // extension can inject one, and it must not take the whole export down.
    }
  }
  return out
}

async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new ShareError('Could not read an image on the invoice.')
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new ShareError('Could not read an image on the invoice.'))
    fr.readAsDataURL(blob)
  })
}

/** Replace every <img src> in the clone with an inline data: URI. */
async function inlineImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(async img => {
    const src = img.getAttribute('src')
    if (!src || src.startsWith('data:')) return
    try {
      img.setAttribute('src', await toDataUri(src))
    } catch {
      // A logo that won't load is not worth failing the whole share over —
      // drop it and send the invoice without it.
      img.remove()
    }
  }))
}

/**
 * Rasterise an element to a PNG at a fixed width.
 *
 * Laid out inside an off-screen IFRAME rather than a hidden div, because media
 * queries resolve against the viewport, not the element. Measured in the page,
 * a phone would report the height of the mobile card layout while the
 * <foreignObject> — whose viewport is its own width — rendered the desktop
 * table, and the PNG came out with a slab of dead space under the total. An
 * iframe gives the measurement the same viewport the render will use.
 */
export async function elementToPng(el: HTMLElement, width = LETTER_WIDTH): Promise<Blob> {
  const css = collectCss()

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('style',
    `position:fixed;left:-99999px;top:0;width:${width}px;height:100px;border:0;`)
  document.body.appendChild(frame)

  try {
    const doc = frame.contentDocument
    if (!doc) throw new ShareError('Could not render the invoice as an image.')
    doc.open()
    doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    doc.close()
    const styleEl = doc.createElement('style')
    styleEl.textContent = css
    doc.head.appendChild(styleEl)
    doc.body.style.cssText = 'margin:0;background:#fff;'

    const clone = doc.importNode(el, true) as HTMLElement
    // Screen-only chrome is exactly what print already excludes.
    clone.querySelectorAll('.no-print').forEach(n => n.remove())
    clone.style.width = width + 'px'
    clone.style.maxWidth = 'none'
    clone.style.margin = '0'
    clone.style.borderRadius = '0'
    clone.style.boxShadow = 'none'
    doc.body.appendChild(clone)

    await inlineImages(clone)
    // Let layout settle after the data: URIs land, so the height is the real one.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const height = Math.ceil(clone.getBoundingClientRect().height)

    const wrapper = document.createElement('div')
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    const style = document.createElement('style')
    style.textContent = css
    wrapper.appendChild(style)
    wrapper.appendChild(document.importNode(clone, true))

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">` +
      new XMLSerializer().serializeToString(wrapper) +
      `</foreignObject></svg>`

    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new ShareError('Could not render the invoice as an image.'))
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    })

    const canvas = document.createElement('canvas')
    canvas.width = width * SCALE
    canvas.height = height * SCALE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ShareError('Could not render the invoice as an image.')
    // The sheet's own white, so the PNG is never transparent in a messaging app.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new ShareError('Could not render the invoice as an image.')
    return blob
  } finally {
    frame.remove()
  }
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Hand the invoice to the OS share sheet, or save it if the browser has none.
 *
 * Returns what actually happened rather than throwing on cancel: a person
 * backing out of the share sheet is a normal outcome, not an error to report.
 */
export async function shareInvoice(
  el: HTMLElement, filename: string, title: string,
): Promise<ShareOutcome> {
  const blob = await elementToPng(el)
  const file = new File([blob], `${filename}.png`, { type: 'image/png' })

  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      // AbortError is the share sheet being dismissed — say nothing about it.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // Anything else falls through to saving, which always works.
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
