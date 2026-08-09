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

/**
 * Shrink a camera photo to something sane before upload. A raw 4-5MB phone
 * shot becomes ~200KB, which matters both for the free tier's 1GB and for
 * uploading over cell data in a supplier's parking lot.
 */
export async function downscale(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ReceiptError('That image is over 25MB — try a smaller photo.')
  }
  const img = await loadImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ReceiptError('Could not process that image.')
  ctx.drawImage(img, 0, 0, w, h)

  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', QUALITY))
  if (!blob) throw new ReceiptError('Could not process that image.')
  return blob
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

  const blob = await downscale(file)
  const path = `${user.id}/${expenseId}-${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
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

  const blob = await downscale(file)
  const path = `${user.id}/job-${entryId}-${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new ReceiptError(error.message)
  return path
}

/**
 * Upload the business logo. One object per user, overwritten in place, so a
 * re-upload can't leave the old file orphaned in Storage.
 */
export async function uploadLogo(supabase: SupabaseClient, file: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new ReceiptError('You need to be signed in to upload a logo.')

  const blob = await downscale(file)
  const path = `${user.id}/logo.jpg`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new ReceiptError(error.message)
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
