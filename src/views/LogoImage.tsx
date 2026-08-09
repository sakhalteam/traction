import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { receiptUrl } from '../receipts'

/**
 * The business logo, resolved from its private-bucket path to a short-lived
 * signed URL at render time. Same reasoning as JobPhotos: signed URLs expire,
 * so storing one would just be a broken image with extra steps.
 *
 * Renders nothing until the URL resolves, and nothing at all if it fails — a
 * missing logo should never be a broken-image icon on an invoice going to a
 * client.
 */
export function LogoImage({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    receiptUrl(supabase, path)
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(() => { /* no logo is better than a broken one */ })
    return () => { cancelled = true }
  }, [path])

  if (!url) return null
  return <img src={url} alt="" className={className} />
}
