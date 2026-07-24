import { useState } from 'react'
import type { Client, TractionState } from '../types'
import { formatDuration, formatMoney, liveSeconds, lineAmount } from '../store'

export function ClientsView({
  state, onAdd, onUpdate, onDelete, onGoInvoice,
}: {
  state: TractionState
  onAdd: (name: string) => Client
  onUpdate: (c: Client) => void
  onDelete: (id: string) => void
  onGoInvoice: () => void
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
                    onSave={updated => { onUpdate(updated); setEditingId(null) }}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => { onDelete(c.id); setEditingId(null) }}
                  />
                ) : (
                  <>
                    <div className="client-head">
                      <h3>{c.name}</h3>
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
                      <button className="btn" onClick={onGoInvoice}>Create invoice →</button>
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
  client, onSave, onCancel, onDelete,
}: {
  client: Client
  onSave: (c: Client) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [c, setC] = useState(client)
  const [confirmDel, setConfirmDel] = useState(false)
  const set = (patch: Partial<Client>) => setC(prev => ({ ...prev, ...patch }))

  return (
    <div className="client-editor">
      <label className="field"><span>Name</span>
        <input value={c.name} onChange={e => set({ name: e.target.value })} /></label>
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
