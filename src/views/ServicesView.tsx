import { useState } from 'react'
import type { Service, TractionState } from '../types'
import { formatMoney, PALETTE } from '../store'

export function ServicesView({
  state, onAdd, onUpdate, onDelete,
}: {
  state: TractionState
  onAdd: (name: string, rate: number) => Service
  onUpdate: (s: Service) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const services = [...state.services].sort((a, b) => a.name.localeCompare(b.name))

  function usageCount(serviceId: string) {
    return state.entries.filter(e => e.serviceId === serviceId).length
  }

  function add() {
    if (!name.trim()) return
    onAdd(name.trim(), Number(rate) || 0)
    setName('')
    setRate('')
  }

  return (
    <div className="view">
      <div className="panel">
        <h2>Services</h2>
        <p className="hint">Reusable types of work with a default rate. Reused across all clients — the client-specific detail lives on each time entry.</p>
        <div className="quick-row">
          <input placeholder="Service name (e.g. Deck cleanup)" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <input className="narrow" type="number" min="0" placeholder="$/hr" value={rate}
            onChange={e => setRate(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <button className="btn primary" onClick={add}>Add service</button>
        </div>
      </div>

      {services.length === 0 ? (
        <p className="hint">No services yet.</p>
      ) : (
        <div className="panel">
          <ul className="service-list">
            {services.map(s => {
              const isEditing = editingId === s.id
              const uses = usageCount(s.id)
              return (
                <li key={s.id} className="service-row">
                  {isEditing ? (
                    <ServiceEditor
                      service={s}
                      onSave={updated => { onUpdate(updated); setEditingId(null) }}
                      onCancel={() => setEditingId(null)}
                      onDelete={uses === 0 ? () => { onDelete(s.id); setEditingId(null) } : undefined}
                    />
                  ) : (
                    <>
                      <span className="entry-swatch" style={{ background: s.color }} />
                      <span className="service-name">{s.name}</span>
                      <span className="service-rate">{formatMoney(s.defaultRate, state.settings.currency)}/hr</span>
                      <span className="dim service-uses">{uses} entr{uses === 1 ? 'y' : 'ies'}</span>
                      <button className="icon-btn" title="Edit" onClick={() => setEditingId(s.id)}>✎</button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="hint tiny">
            Changing a rate here only affects <em>future</em> timers. Past entries keep the rate they were logged at.
          </p>
        </div>
      )}
    </div>
  )
}

function ServiceEditor({
  service, onSave, onCancel, onDelete,
}: {
  service: Service
  onSave: (s: Service) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [s, setS] = useState(service)
  const set = (patch: Partial<Service>) => setS(prev => ({ ...prev, ...patch }))

  return (
    <div className="service-editor">
      <div className="field-row">
        <label className="field"><span>Name</span>
          <input value={s.name} onChange={e => set({ name: e.target.value })} /></label>
        <label className="field narrow-field"><span>Rate /hr</span>
          <input type="number" min="0" value={s.defaultRate}
            onChange={e => set({ defaultRate: Number(e.target.value) || 0 })} /></label>
      </div>
      <div className="swatch-row">
        {PALETTE.map(color => (
          <button key={color} className={`swatch ${s.color === color ? 'sel' : ''}`}
            style={{ background: color }} onClick={() => set({ color })} aria-label={color} />
        ))}
      </div>
      <div className="editor-actions">
        <button className="btn primary" onClick={() => onSave(s)}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {onDelete
          ? <button className="btn danger ghost" onClick={onDelete}>Delete</button>
          : <span className="hint tiny">In use — can't delete.</span>}
      </div>
    </div>
  )
}
