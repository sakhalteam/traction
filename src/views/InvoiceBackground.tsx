import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { receiptUrl } from '../receipts'
import defaultBg from '../assets/invoice-bg.png'

/**
 * The watermark behind an invoice.
 *
 * Rendered as an <img>, not a CSS background-image: browsers drop background
 * images from printed output unless the user ticks "background graphics", and
 * an invoice's paper is not something to leave to a print dialog checkbox. An
 * <img> prints every time.
 *
 * There is always a background — the topographic default ships with the app —
 * so `path` only ever names an override. While a custom one is resolving to a
 * signed URL the default stays up, which avoids a blank flash on every render.
 */
export function InvoiceBackground({ path }: { path?: string | null }) {
  const [custom, setCustom] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCustom(null)
    if (!path) return
    receiptUrl(supabase, path)
      .then(u => { if (!cancelled) setCustom(u) })
      .catch(() => { /* fall back to the bundled one rather than to nothing */ })
    return () => { cancelled = true }
  }, [path])

  return <img className="invoice-bg" src={custom ?? defaultBg} alt="" aria-hidden="true" />
}
