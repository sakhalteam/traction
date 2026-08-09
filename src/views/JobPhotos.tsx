import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ReceiptError, receiptUrl } from '../receipts'

/**
 * Job photos for a time entry — the before/after shots of actual work.
 *
 * The bucket is private, so each path has to be exchanged for a short-lived
 * signed URL before it can be rendered. Those are resolved here and held in
 * component state rather than stored anywhere: they expire, and a persisted
 * signed URL is just a broken image with extra steps.
 */
export function JobPhotos({
  paths, editable = false, onAdd, onRemove,
}: {
  paths: string[]
  editable?: boolean
  onAdd?: (file: File) => Promise<void>
  onRemove?: () => Promise<void>
}) {
  const [urls, setUrls] = useState<string[]>([])
  /** null = idle, else "how many of how many" for the current batch. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Two inputs, not one: `capture` FORCES the camera on mobile, so a single
  // input can shoot a new photo or pick an existing one, never both.
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const busy = progress !== null

  // Depend on the CONTENTS, not the array identity. Callers build this list
  // inline (`entry.photoPaths ?? []`, a flatMap over an invoice's entries), so a
  // fresh reference arrives every render — keying the effect on the array itself
  // would re-resolve, set state, re-render, and spin forever.
  const key = paths.join('|')

  useEffect(() => {
    let cancelled = false
    const list = key ? key.split('|') : []
    if (list.length === 0) { setUrls([]); return }
    Promise.all(list.map(p => receiptUrl(supabase, p).catch(() => null)))
      .then(resolved => {
        // The effect can outlive the component when paths change quickly.
        if (!cancelled) setUrls(resolved.filter((u): u is string => u !== null))
      })
    return () => { cancelled = true }
  }, [key])

  /**
   * Upload a batch one at a time. Sequential rather than parallel so a dozen
   * full-size phone shots can't saturate a cell connection in someone's
   * driveway, and so a failure halfway through still keeps what already landed.
   */
  async function pick(files: FileList, input: HTMLInputElement | null) {
    if (!onAdd || files.length === 0) return
    const list = [...files]
    setError(null)
    setProgress({ done: 0, total: list.length })
    let failed = 0
    for (const [i, file] of list.entries()) {
      try {
        await onAdd(file)
      } catch (err) {
        failed++
        setError(err instanceof ReceiptError ? err.message : 'Could not attach that photo.')
      }
      setProgress({ done: i + 1, total: list.length })
    }
    if (failed > 0 && list.length > 1) {
      setError(`${list.length - failed} of ${list.length} photos added — the rest failed.`)
    }
    setProgress(null)
    // Clearing lets you pick the same file again after removing it.
    if (input) input.value = ''
  }

  if (paths.length === 0 && !editable) return null

  return (
    <div className="job-photos">
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer"
          className="job-thumb" title="Open full size">
          <img src={u} alt={`Job photo ${i + 1}`} loading="lazy" />
        </a>
      ))}
      {editable && (
        <>
          {/* capture="environment" opens the rear camera straight from a phone,
              which is where these get taken — standing in the yard, not at a desk. */}
          <input
            ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { if (e.target.files) void pick(e.target.files, e.target) }}
          />
          {/* No `capture`, so this reaches the gallery/filesystem instead, and
              takes a whole before/after set in one go. */}
          <input
            ref={libraryRef} type="file" accept="image/*" multiple hidden
            onChange={e => { if (e.target.files) void pick(e.target.files, e.target) }}
          />
          <button
            className="job-thumb add" disabled={busy}
            title="Take a photo now"
            onClick={() => cameraRef.current?.click()}
          >
            📷
          </button>
          <button
            className="job-thumb add" disabled={busy}
            title="Upload photos from this device — pick several at once"
            onClick={() => libraryRef.current?.click()}
          >
            🖼
          </button>
          {paths.length > 0 && onRemove && (
            <button
              className="btn ghost tiny" disabled={busy}
              title="Remove the most recent photo"
              onClick={() => void onRemove()}
            >
              Remove last
            </button>
          )}
        </>
      )}
      {progress && (
        <span className="hint tiny">
          {progress.total > 1
            ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : 'Uploading…'}
        </span>
      )}
      {error && <span className="hint tiny err">{error}</span>}
    </div>
  )
}
