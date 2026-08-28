import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Receipt photo storage.
 *
 * Images live in the private `receipts` Supabase Storage bucket — never in
 * `state_json`. The whole app state is upserted as one JSON blob on every
 * debounced save, so inlining a photo would re-upload every receipt on every
 * keystroke. Expenses carry only the object path.
 */

export const RECEIPT_BUCKET = 'receipts'

/** Longest edge, in px, we keep. A 4032px phone photo lands ~1600px. */
const MAX_EDGE = 1600
/**
 * Logos are smaller: an invoice prints one about 220px wide, so 800 is already
 * generous for print. It matters here because a transparent logo is stored as
 * PNG, which has no lossy setting to lean on — resolution is the only lever.
 */
const LOGO_MAX_EDGE = 800
/** JPEG quality for the downscaled copy. */
const QUALITY = 0.82
/** Reject anything above this BEFORE decoding, to avoid OOM on a huge file. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024

export class ReceiptError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ReceiptError("That file isn't a readable image.")) }
    img.src = url
  })
}

/** A processed image, plus what it actually got encoded as. */
export interface Downscaled {
  blob: Blob
  contentType: string
  /** Extension matching contentType, no dot — the stored path has to agree. */
  ext: 'jpg' | 'png'
}

/**
 * Does this canvas actually use its alpha channel?
 *
 * Asked of the pixels rather than the file's MIME type because most PNGs are
 * fully opaque, and storing those as PNG would multiply their size for nothing.
 * The canvas is drawn from a blob: URL of a local File, so it is same-origin
 * and readable; if a browser disagrees, we assume alpha and keep the pixels.
 */
function usesAlpha(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true
    }
    return false
  } catch {
    return true
  }
}

/**
 * Shrink an image to something sane before upload. A raw 4-5MB phone shot
 * becomes ~200KB, which matters both for the free tier's 1GB and for uploading
 * over cell data in a supplier's parking lot.
 *
 * `preserveAlpha` picks PNG over JPEG when the image genuinely has transparent
 * pixels. JPEG has no alpha channel at all, so encoding a transparent logo as
 * one composites every clear pixel against the canvas's zeroed RGBA — which is
 * black. That is not a rendering bug to fix downstream: the black is burned
 * into the stored file, and only re-uploading can undo it.
 */
export async function downscale(
  file: File,
  opts: { maxEdge?: number; preserveAlpha?: boolean } = {},
): Promise<Downscaled> {
  const { maxEdge = MAX_EDGE, preserveAlpha = false } = opts
  if (file.size > MAX_INPUT_BYTES) {
    throw new ReceiptError('That image is over 25MB — try a smaller photo.')
  }
  const img = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ReceiptError('Could not process that image.')
  ctx.drawImage(img, 0, 0, w, h)

  const keepAlpha = preserveAlpha && usesAlpha(canvas, ctx)
  const contentType = keepAlpha ? 'image/png' : 'image/jpeg'
  // PNG is lossless; toBlob ignores the quality argument for it.
  const blob = await new Promise<Blob | null>(res =>
    canvas.toBlob(res, contentType, keepAlpha ? undefined : QUALITY))
  if (!blob) throw new ReceiptError('Could not process that image.')
  return { blob, contentType, ext: keepAlpha ? 'png' : 'jpg' }
}

/**
 * Upload a receipt for an expense and return its object path.
 * The path is prefixed with the user id — that prefix is what the Storage RLS
 * policies check, so a user can only ever write inside their own folder.
 */
export async function uploadReceipt(
  supabase: SupabaseClient, expenseId: string, file: File,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new ReceiptError('You need to be signed in to attach a receipt.')

  // A receipt is a photograph — opaque by definition, and JPEG is far smaller.
  const { blob, contentType } = await downscale(file)
  const path = `${user.id}/${expenseId}-${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType, upsert: false })
  if (error) throw new ReceiptError(error.message)
  return path
}

/**
 * Upload a job photo for a time entry. Shares the `receipts` bucket and its
 * `<user-id>/…` RLS prefix — the storage rules only care who owns the folder,
 * not what the image depicts, so a second bucket would buy nothing.
 */
export async function uploadJobPhoto(
  supabase: SupabaseClient, entryId: string, file: File,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new ReceiptError('You need to be signed in to attach a photo.')

  const { blob, contentType } = await downscale(file)
  const path = `${user.id}/job-${entryId}-${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType, upsert: false })
  if (error) throw new ReceiptError(error.message)
  return path
}

/**
 * Upload the business logo. One object per user, overwritten in place, so a
 * re-upload can't leave the old file orphaned in Storage.
 *
 * Alone among the three, this one keeps transparency: a logo is artwork, not a
 * photograph, and a cut-out one has to sit on the invoice's white paper without
 * dragging a black rectangle along with it.
 */
export async function uploadLogo(supabase: SupabaseClient, file: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new ReceiptError('You need to be signed in to upload a logo.')

  const { blob, contentType, ext } = await downscale(file, {
    maxEdge: LOGO_MAX_EDGE, preserveAlpha: true,
  })
  const path = `${user.id}/logo.${ext}`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType, upsert: true })
  if (error) throw new ReceiptError(error.message)
  // Swapping a JPEG logo for a PNG one (or back) writes a different object, so
  // clear the other extension rather than stranding it in the bucket forever.
  void deleteReceipt(supabase, `${user.id}/logo.${ext === 'png' ? 'jpg' : 'png'}`)
  return path
}

/**
 * A short-lived signed URL for viewing/printing a receipt. The bucket is
 * private, so this is the only way to read one.
 */
export async function receiptUrl(
  supabase: SupabaseClient, path: string, expiresInSeconds = 60 * 60,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error || !data) throw new ReceiptError(error?.message ?? 'Could not open that receipt.')
  return data.signedUrl
}

/**
 * Best-effort removal. A failure here is deliberately non-fatal: an orphaned
 * object is a far better outcome than blocking the user from deleting or
 * replacing an expense.
 */
export async function deleteReceipt(supabase: SupabaseClient, path: string): Promise<void> {
  await supabase.storage.from(RECEIPT_BUCKET).remove([path])
}
