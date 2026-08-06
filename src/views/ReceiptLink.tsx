import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { ReceiptError, receiptUrl } from '../receipts'

/**
 * Opens a stored receipt photo in a new tab via a short-lived signed URL.
 * Opened rather than embedded so it prints straight from the browser — which
 * is the whole point when a client wants a hard copy.
 */
export function ReceiptLink({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      window.open(await receiptUrl(supabase, path), '_blank', 'noopener')
    } catch (err) {
      setError(err instanceof ReceiptError ? err.message : 'Could not open that receipt.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn ghost tiny receipt-link" disabled={busy} onClick={open}>
      🧾 {busy ? 'Opening…' : label}
      {error && <span className="receipt-error" title={error}> !</span>}
    </button>
  )
}
