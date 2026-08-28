import { useState } from 'react'
import type { Client, Person, Service, TractionState } from '../types'
import {
  formatDuration, formatMoney, liveSeconds, lineAmount,
  clientInvoiceCode, compactDate, normalizeInvoiceCode, todayISO, INVOICE_SEQ_PAD,
  CLIENT_COLORS, clientColor,
  clientFullName, clientShortName, clientSortKey, hasStructuredName, splitLegacyName,
} from '../store'
import { ClientLabel } from '../Chrome'

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

  // Alphabetised on surname / business, not on whatever the full name starts
  // with — "Sylvia & Craig Gardner" belongs under G.
  const clients = [...state.clients].sort((a, b) => clientSortKey(a).localeCompare(clientSortKey(b)))
  const durationStyle = state.settings.durationFormat ?? 'hm'

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
                      {/* The name renders once, as the pill — the card used to
                          show a plain heading AND a duplicate coloured copy. */}
                      <h3 className="client-name-pill">
                        <ClientLabel name={clientFullName(c)} color={clientColor(c)} />
                      </h3>
                      <button className="icon-btn" title="Edit" onClick={() => setEditingId(c.id)}>✎</button>
                    </div>
                    <div className="client-codeline">
                      <span className="inv-code-tag" title="Invoice-number prefix">{clientInvoiceCode(c)}</span>
                      {clientShortName(c) !== clientFullName(c) && (
                        <span className="dim tiny" title="How this client reads on pills and chips">
                          shows as “{clientShortName(c)}”
                        </span>
                      )}
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
                      <div className="dim">{u.count} entr{u.count === 1 ? 'y' : 'ies'} · {formatDuration(u.seconds, durationStyle)}</div>
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
  /**
   * A client that never got structured names opens with its old single-line
   * name split into the fields, as a starting point to correct. The split is
   * only ever shown in this form — running it over saved data would silently
   * turn "Larry & Linda O'Neil" into somebody's first name.
   */
  const [seeded] = useState(() => !hasStructuredName(client))
  const [c, setC] = useState<Client>(() => hasStructuredName(client)
    ? client
    : { ...client, people: splitLegacyName(client.name), business: '' })
  const [confirmDel, setConfirmDel] = useState(false)
  const [showRates, setShowRates] = useState(false)
  const set = (patch: Partial<Client>) => setC(prev => ({ ...prev, ...patch }))

  const people = c.people ?? []
  const setPerson = (i: number, patch: Partial<Person>) => setC(prev => ({
    ...prev,
    people: (prev.people ?? []).map((p, n) => n === i ? { ...p, ...patch } : p),
  }))
  const addPerson = () => setC(prev => ({ ...prev, people: [...(prev.people ?? []), { first: '', last: '' }] }))
  const removePerson = (i: number) => setC(prev => ({
    ...prev,
    people: (prev.people ?? []).filter((_, n) => n !== i),
  }))

  const named = hasStructuredName(c)
  // `name` is a denormalised mirror for legacy readers and backup files; the
  // structured fields are the truth, so it's rewritten from them on every save.
  const save = () => onSave({ ...c, name: clientFullName(c) })

  const setRate = (serviceId: string, value: string) => {
    setC(prev => {
      const rates = { ...prev.rates }
      if (value === '') delete rates[serviceId]
      else rates[serviceId] = Number(value) || 0
      return { ...prev, rates }
    })
  }

  const overrideCount = Object.keys(c.rates).length
  const selectedColor = clientColor(c)
  // Today's date on purpose: it's what they'd get if they invoiced right now.
  const numberPreview =
    `${clientInvoiceCode(c)}-${compactDate(todayISO())}-${'1'.padStart(INVOICE_SEQ_PAD, '0')}`

  return (
    <div className="client-editor">
      {people.map((p, i) => (
        <div className="field-row person-row" key={i}>
          <label className="field"><span>{i === 0 ? 'First name' : 'And — first name'}</span>
            <input value={p.first} onChange={e => setPerson(i, { first: e.target.value })} /></label>
          <label className="field"><span>Last name</span>
            <input value={p.last} onChange={e => setPerson(i, { last: e.target.value })} /></label>
          {people.length > 1 && (
            <button type="button" className="icon-btn danger person-drop"
              title="Remove this person" onClick={() => removePerson(i)}>✕</button>
          )}
        </div>
      ))}
      {/* Hidden behind a tap: a client is usually one person, and two empty
          boxes on every card would imply otherwise. */}
      <button type="button" className="btn ghost tiny add-person" onClick={addPerson}>
        + Add another person
      </button>
      <label className="field"><span>Business</span>
        <input value={c.business ?? ''} placeholder="e.g. FARTTOWN PIZZAS"
          onChange={e => set({ business: e.target.value })} /></label>
      <p className="hint tiny">
        {named
          ? <>Reads as <strong>{clientFullName(c)}</strong>{clientShortName(c) !== clientFullName(c)
              ? <> on invoices, <strong>{clientShortName(c)}</strong> on pills and chips.</>
              : <> everywhere.</>}</>
          : <>Fill in a name — a person, a business, or both.</>}
        {seeded && <> Split from the old name “{client.name}”; fix anything it got wrong.</>}
      </p>
      <label className="field"><span>Invoice code</span>
        <input
          value={c.invoiceCode ?? ''}
          maxLength={16}
          placeholder={normalizeInvoiceCode(clientShortName(c))}
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
      <div className="field">
        <span>Pill colour</span>
        <div className="swatch-row client-swatches">
          <button
            type="button"
            className={`swatch client-swatch ${!c.colorId ? 'sel' : ''}`}
            title="Default"
            aria-label="Default"
            aria-pressed={!c.colorId}
            onClick={() => set({ colorId: undefined })}
          >A</button>
          {CLIENT_COLORS.map(col => (
            <button
              key={col.id}
              type="button"
              className={`swatch client-swatch ${c.colorId === col.id ? 'sel' : ''}`}
              style={{ background: col.bg, color: col.fg }}
              /* Named, not just shown: picking a colour you can't reliably see
                 has to work by label, and the title is that label. */
              title={col.label}
              aria-label={col.label}
              aria-pressed={c.colorId === col.id}
              onClick={() => set({ colorId: col.id })}
            >A</button>
          ))}
        </div>
        <p className="hint tiny">
          <ClientLabel name={named ? clientShortName(c) : 'Client'} color={clientColor(c)} />
          {' '}— how this client reads in the time log. {selectedColor?.label ?? 'Default'}.
        </p>
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
        <button className="btn primary" disabled={!named} onClick={save}>Save</button>
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
