import { useState } from 'react'
import type { Settings, TractionState } from '../types'

export function SettingsView({
  state, onUpdate, onReset,
}: {
  state: TractionState
  onUpdate: (s: Settings) => void
  onReset: () => void
}) {
  const [s, setS] = useState(state.settings)
  const [confirmReset, setConfirmReset] = useState(false)
  const set = (patch: Partial<Settings>) => setS(prev => ({ ...prev, ...patch }))
  const dirty = JSON.stringify(s) !== JSON.stringify(state.settings)

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
        <div className="field-row">
          <label className="field narrow-field"><span>Currency symbol</span>
            <input value={s.currency} maxLength={3} onChange={e => set({ currency: e.target.value })} /></label>
          <label className="field narrow-field"><span>Next invoice #</span>
            <input type="number" min="1" value={s.invoiceCounter}
              onChange={e => set({ invoiceCounter: Number(e.target.value) || 1 })} /></label>
        </div>
        <button className="btn primary" disabled={!dirty} onClick={() => onUpdate(s)}>
          {dirty ? 'Save changes' : 'Saved'}
        </button>
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
