import { useState } from 'react'
import type { Client, Service, TractionState } from '../types'
import {
  formatDuration, formatMoney, liveSeconds, lineAmount,
  clientInvoiceCode, compactDate, normalizeInvoiceCode, todayISO, INVOICE_SEQ_PAD,
} from '../store'

export function ClientsView({
  state, onAdd, onUpdate, onDelete, onGoInvoice,
}: {
  state: TractionState
  onAdd: (name: string) => Client
  onUpdate: (c: Client) => void
  onDelete: (id: string) => void
  onGoInvoice: (clientId?: string) => void
}) {
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name))

  function unbilled(clientId: string) {
    const entries = state.entries.filter(e => e.clientId === clientId && !e.invoiceId && !e.runningSince)
    const seconds = entries.reduce((s, e) => s + liveSeconds(e), 0)
    const amount = entries.reduce((s, e) => s + lineAmount(liveSeconds(e), e.rate), 0)
    return { seconds, amount, count: entries.length }
  }

  function add() {
    if (!name.trim()) return
    onAdd(name.trim())
    setName('')
  }

  return (
    <div className="view">
      <div className="panel">
        <h2>Clients</h2>
        <div className="quick-row">
          <input placeholder="Client name (e.g. Larry & Linda)" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <button className="btn primary" onClick={add}>Add client</button>
        </div>
      </div>

      {clients.length === 0 ? (
        <p className="hint">No clients yet. Add your first above.</p>
      ) : (
        <div className="card-grid">
          {clients.map(c => {
            const u = unbilled(c.id)
            const isEditing = editingId === c.id
            return (
              <div key={c.id} className="panel client-card">
                {isEditing ? (
                  <ClientEditor
                    client={c}
                    services={state.services.filter(s => !s.archived)}
                    currency={state.settings.currency}
                    onSave={updated => { onUpdate(updated); setEditingId(null) }}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => { onDelete(c.id); setEditingId(null) }}
                  />
                ) : (
                  <>
                    <div className="client-head">
                      <h3>{c.name}</h3>
                      {/* Only shown when it's been overridden — the default is
                          just the name, and echoing that back is noise. */}
                      {c.invoiceCode && (
                        <span className="dim tiny inv-code-tag" title="Invoice code">{clientInvoiceCode(c)}</span>
                      )}
                      <button className="icon-btn" title="Edit" onClick={() => setEditingId(c.id)}>✎</button>
                    </div>
                    {(c.email || c.phone) && (
                      <div className="client-contact">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
                    )}
                    {c.address && <div className="client-contact dim">{c.address}</div>}
                    <div className="client-unbilled">
                      <div>
                        <span className="big-money">{formatMoney(u.amount, state.settings.currency)}</span>
                        <span className="dim"> unbilled</span>
                      </div>
                      <div className="dim">{u.count} entr{u.count === 1 ? 'y' : 'ies'} · {formatDuration(u.seconds)}</div>
                    </div>
                    {u.count > 0 && (
                      <button className="btn" onClick={() => onGoInvoice(c.id)}>Create invoice →</button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ClientEditor({
  client, services, currency, onSave, onCancel, onDelete,
}: {
  client: Client
  services: Service[]
  currency: string
  onSave: (c: Client) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [c, setC] = useState(client)
  const [confirmDel, setConfirmDel] = useState(false)
  const [showRates, setShowRates] = useState(false)
  const set = (patch: Partial<Client>) => setC(prev => ({ ...prev, ...patch }))

  const setRate = (serviceId: string, value: string) => {
    setC(prev => {
      const rates = { ...prev.rates }
      if (value === '') delete rates[serviceId]
      else rates[serviceId] = Number(value) || 0
      return { ...prev, rates }
    })
  }

  const overrideCount = Object.keys(c.rates).length
  // Today's date on purpose: it's what they'd get if they invoiced right now.
  const numberPreview =
    `${clientInvoiceCode(c)}-${compactDate(todayISO())}-${'1'.padStart(INVOICE_SEQ_PAD, '0')}`

  return (
    <div className="client-editor">
      <label className="field"><span>Name</span>
        <input value={c.name} onChange={e => set({ name: e.target.value })} /></label>
      <label className="field"><span>Invoice code</span>
        <input
          value={c.invoiceCode ?? ''}
          maxLength={16}
          placeholder={normalizeInvoiceCode(c.name)}
          /* Normalised as you type so the field always shows the exact string
             that will appear on the invoice — no surprise at creation time. */
          onChange={e => set({ invoiceCode: normalizeInvoiceCode(e.target.value) })}
        /></label>
      <p className="hint tiny">
        Invoice numbers for this client look like <strong>{numberPreview}</strong> — the last
        pair counts up per day and resets at midnight. Leave blank to use the name.
      </p>
      <div className="field-row">
        <label className="field"><span>Phone</span>
          <input value={c.phone} onChange={e => set({ phone: e.target.value })} /></label>
        <label className="field"><span>Email</span>
          <input value={c.email} onChange={e => set({ email: e.target.value })} /></label>
      </div>
      <label className="field"><span>Address</span>
        <input value={c.address} onChange={e => set({ address: e.target.value })} /></label>
      <label className="field"><span>Notes</span>
        <textarea value={c.notes} rows={2} onChange={e => set({ notes: e.target.value })} /></label>

      {services.length > 0 && (
        <div className="rate-overrides">
          <button type="button" className="rate-toggle" onClick={() => setShowRates(v => !v)}>
            {showRates ? '▾' : '▸'} Custom rates for this client
            {overrideCount > 0 && <span className="rate-badge">{overrideCount}</span>}
          </button>
          {showRates && (
            <div className="rate-list">
              {services.map(s => (
                <div key={s.id} className="rate-override-row">
                  <span className="entry-swatch" style={{ background: s.color }} />
                  <span className="rate-svc-name">{s.name}</span>
                  <input type="number" min="0" className="narrow"
                    placeholder={`${currency}${s.defaultRate}`}
                    value={c.rates[s.id] ?? ''}
                    onChange={e => setRate(s.id, e.target.value)} />
                </div>
              ))}
              <p className="hint tiny">Blank = use the service default. Overrides apply to new entries only.</p>
            </div>
          )}
        </div>
      )}

      <div className="editor-actions">
        <button className="btn primary" onClick={() => onSave(c)}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {confirmDel ? (
          <button className="btn danger" onClick={onDelete}>Really delete?</button>
        ) : (
          <button className="btn danger ghost" onClick={() => setConfirmDel(true)}>Delete</button>
        )}
      </div>
      <p className="hint tiny">Deleting keeps time entries (they become "General") so billing history stays intact.</p>
    </div>
  )
}
