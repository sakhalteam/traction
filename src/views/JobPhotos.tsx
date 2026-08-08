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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    if (paths.length === 0) { setUrls([]); return }
    Promise.all(paths.map(p => receiptUrl(supabase, p).catch(() => null)))
      .then(resolved => {
        // The effect can outlive the component when paths change quickly.
        if (!cancelled) setUrls(resolved.filter((u): u is string => u !== null))
      })
    return () => { cancelled = true }
  }, [paths])

  async function pick(file: File) {
    if (!onAdd) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(file)
    } catch (err) {
      setError(err instanceof ReceiptError ? err.message : 'Could not attach that photo.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
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
            ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f) }}
          />
          <button
            className="job-thumb add" disabled={busy}
            title="Add a job photo"
            onClick={() => fileRef.current?.click()}
          >
            {busy ? '…' : '＋'}
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
      {error && <span className="hint tiny err">{error}</span>}
    </div>
  )
}
