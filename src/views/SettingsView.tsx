import { useRef, useState } from 'react'
import type { DurationStyle, Settings, TractionState } from '../types'
import { entriesToCSV, expensesToCSV, parseBackup, serializeBackup, todayISO } from '../store'
import { ReceiptError, uploadLogo } from '../receipts'
import { supabase } from '../supabaseClient'
import { DurationToggle } from './DurationFields'
import { LogoImage } from './LogoImage'

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function SettingsView({
  state, onUpdate, onReset, onImport, onSetDurationFormat,
}: {
  state: TractionState
  onUpdate: (s: Settings) => void
  onReset: () => void
  onImport: (state: TractionState) => void
  onSetDurationFormat: (style: DurationStyle) => void
}) {
  const [s, setS] = useState(state.settings)
  const [confirmReset, setConfirmReset] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoMsg, setLogoMsg] = useState<string | null>(null)

  /**
   * Saved immediately rather than waiting for "Save changes". The upload has
   * already happened by this point, so leaving the path unsaved would strand a
   * file in Storage that nothing references.
   */
  async function pickLogo(file: File) {
    setLogoBusy(true)
    setLogoMsg(null)
    try {
      const path = await uploadLogo(supabase, file)
      const next = { ...s, logoPath: path }
      setS(next)
      onUpdate(next)
    } catch (err) {
      setLogoMsg(err instanceof ReceiptError ? err.message : 'Could not upload that image.')
    } finally {
      setLogoBusy(false)
      if (logoRef.current) logoRef.current.value = ''
    }
  }
  const set = (patch: Partial<Settings>) => setS(prev => ({ ...prev, ...patch }))
  const dirty = JSON.stringify(s) !== JSON.stringify(state.settings)

  function exportCSV() {
    download(`traction-time-${todayISO()}.csv`, entriesToCSV(state), 'text/csv')
  }
  function exportExpensesCSV() {
    download(`traction-expenses-${todayISO()}.csv`, expensesToCSV(state), 'text/csv')
  }
  function exportJSON() {
    download(`traction-backup-${todayISO()}.json`, serializeBackup(state), 'application/json')
  }
  async function importFile(file: File) {
    try {
      const imported = parseBackup(await file.text())
      onImport(imported)
      setImportMsg({ ok: true, text: 'Backup restored.' })
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not read that file.' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="view">
      <div className="panel">
        <h2>Business details</h2>
        <p className="hint">These appear in the "from" block on every invoice.</p>
        <label className="field"><span>Business name</span>
          <input value={s.businessName} onChange={e => set({ businessName: e.target.value })}
            placeholder="Friendly Pressure" /></label>
        <div className="field-row">
          <label className="field"><span>Phone</span>
            <input value={s.businessPhone} onChange={e => set({ businessPhone: e.target.value })} /></label>
          <label className="field"><span>Email</span>
            <input value={s.businessEmail} onChange={e => set({ businessEmail: e.target.value })} /></label>
        </div>
        <label className="field"><span>Address</span>
          <input value={s.businessAddress} onChange={e => set({ businessAddress: e.target.value })} /></label>

        <div className="field">
          <span>Logo</span>
          <div className="logo-row">
            {s.logoPath
              ? <LogoImage path={s.logoPath} className="logo-preview" />
              : <div className="logo-preview empty">No logo</div>}
            <input
              ref={logoRef} type="file" accept="image/*" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) void pickLogo(f) }}
            />
            <button className="btn" disabled={logoBusy} onClick={() => logoRef.current?.click()}>
              {logoBusy ? 'Uploading…' : s.logoPath ? 'Replace logo' : 'Upload logo'}
            </button>
            {s.logoPath && !logoBusy && (
              <button className="btn ghost" onClick={() => { set({ logoPath: null }); onUpdate({ ...s, logoPath: null }) }}>
                Remove
              </button>
            )}
          </div>
          {logoMsg && <p className="hint tiny err">{logoMsg}</p>}
          <p className="hint tiny">Appears at the top of every invoice. Saved as soon as it uploads.</p>
        </div>
        <div className="field-row">
          <label className="field narrow-field"><span>Currency symbol</span>
            <input value={s.currency} maxLength={3} onChange={e => set({ currency: e.target.value })} /></label>
          <label className="field narrow-field"><span>Payment terms</span>
            <input type="number" min="0" max="365" value={s.netDays}
              onChange={e => set({ netDays: Math.max(0, Number(e.target.value) || 0) })} /></label>
        </div>
        <p className="hint tiny">
          Terms are the days a client has to pay. Each new invoice freezes the terms in
          effect the day it's created, so changing this never makes an old invoice overdue.
        </p>
        <p className="hint tiny">
          Invoice numbers are <strong>CODE-YYYYMMDD-NN</strong>, counting up per client per
          day. Set a client's code under <strong>Clients</strong>; it defaults to their name.
        </p>
        <div className="field">
          <span>Show hours as</span>
          {/* Saves on tap rather than waiting for the button below: it's a
              display switch you flip to look at something, and reading the
              effect is the whole point. */}
          <DurationToggle
            value={state.settings.durationFormat ?? 'hm'}
            onChange={style => { set({ durationFormat: style }); onSetDurationFormat(style) }}
          />
        </div>
        <p className="hint tiny">
          Applies everywhere — the time log, invoices and reports. Also switchable from
          Reports and from the manual-entry form.
        </p>
        <button className="btn primary" disabled={!dirty} onClick={() => onUpdate(s)}>
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <div className="panel">
        <h3>Data &amp; backup</h3>
        <p className="hint">Export for taxes/your accountant, or keep a backup you can restore on any machine.</p>
        <div className="quick-row">
          <button className="btn" onClick={exportCSV}>⬇ Time entries (CSV)</button>
          <button className="btn" onClick={exportExpensesCSV}>⬇ Expenses (CSV)</button>
          <button className="btn" onClick={exportJSON}>⬇ Full backup (JSON)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Restore backup…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f) }} />
        </div>
        {importMsg && (
          <p className={`hint tiny ${importMsg.ok ? 'ok' : 'err'}`}>{importMsg.text}</p>
        )}
        <p className="hint tiny">Restoring replaces everything currently in traction with the backup's contents.</p>
      </div>

      <div className="panel danger-zone">
        <h3>Danger zone</h3>
        <p className="hint">Wipes all clients, services, time entries and invoices from this device (and your synced copy). No undo.</p>
        {confirmReset
          ? (
            <div className="quick-row">
              <button className="btn danger" onClick={onReset}>Yes, erase everything</button>
              <button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          )
          : <button className="btn danger ghost" onClick={() => setConfirmReset(true)}>Reset all data</button>}
      </div>
    </div>
  )
}
