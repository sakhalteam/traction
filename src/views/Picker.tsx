import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface PickerOption {
  id: string
  label: string
  /** Secondary text — a rate, a phone number, whatever disambiguates. */
  hint?: string
  color?: string
}

/**
 * A searchable single-select that replaces a native `<select>` once the list
 * outgrows it.
 *
 * A native select is fine at six services. At forty clients it's a scroll
 * through an unsearchable column, which on a phone means thumbing past
 * everyone whose name starts with A to reach the Steins. This opens as a sheet
 * with the search field focused, so picking a client is: tap, type "ste", tap.
 *
 * Creating is folded into the same flow — if what you typed doesn't exist yet,
 * the top row offers to make it. Adding a client while standing in their
 * driveway shouldn't mean leaving the timer screen.
 */
export function Picker({
  label, value, options, onChange, onCreate, noneLabel, placeholder, createLabel,
}: {
  label: string
  /** null = nothing chosen; matched against option ids. */
  value: string | null
  options: PickerOption[]
  onChange: (id: string | null) => void
  /** Omit to forbid creating from here. Returns the id of the new record. */
  onCreate?: (name: string) => string
  /** Provide to offer an explicit "no selection" row, e.g. "General (no client)". */
  noneLabel?: string
  placeholder?: string
  createLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = value ? options.find(o => o.id === value) ?? null : null

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
  }, [options, query])

  // Offer creation only for a genuinely new name, so typing an existing client's
  // name in full doesn't invite you to make a duplicate of them.
  const trimmed = query.trim()
  const canCreate = !!onCreate && trimmed.length > 0
    && !options.some(o => o.label.toLowerCase() === trimmed.toLowerCase())

  /** Rows in visual order, so the keyboard and the mouse agree on the index. */
  const rows = useMemo(() => {
    const out: { key: string; kind: 'create' | 'none' | 'option'; option?: PickerOption }[] = []
    if (canCreate) out.push({ key: '__create__', kind: 'create' })
    if (noneLabel && !query.trim()) out.push({ key: '__none__', kind: 'none' })
    for (const o of matches) out.push({ key: o.id, kind: 'option', option: o })
    return out
  }, [canCreate, noneLabel, query, matches])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    // Delay a frame so the field exists and the sheet has painted before focus
    // pulls up the mobile keyboard.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Clamp rather than reset: filtering down shouldn't fling the highlight away
  // from where the user was looking.
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, rows.length - 1))) }, [rows.length])

  // Pin the page while the sheet is up. Without this a scroll gesture that
  // misses the list drags the timer screen around behind the overlay, which on
  // a phone reads as the app coming apart.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function choose(row: (typeof rows)[number]) {
    if (row.kind === 'create' && onCreate) onChange(onCreate(trimmed))
    else if (row.kind === 'none') onChange(null)
    else if (row.option) onChange(row.option.id)
    setOpen(false)
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[active]) choose(rows[active])
    }
  }

  return (
    <div className="field picker-field">
      <span>{label}</span>
      <button type="button" className={`picker-trigger ${selected ? '' : 'empty'}`} onClick={() => setOpen(true)}>
        {selected?.color && <span className="chip-dot" style={{ background: selected.color }} />}
        <span className="picker-value">
          {selected ? selected.label : (noneLabel ?? placeholder ?? 'Choose…')}
        </span>
        <svg className="picker-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/*
        Portalled to <body> on purpose. Panels carry `backdrop-filter`, and a
        filtered element becomes the containing block for its `position: fixed`
        descendants — so rendering the sheet in place pinned it to the middle of
        the panel and left the scrim covering only that panel instead of the
        screen. Escaping the subtree is what makes "fixed" mean fixed here.
      */}
      {open && createPortal(
        <>
          <button className="sheet-scrim" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="picker-sheet" role="dialog" aria-label={label}>
            <div className="picker-search">
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder ?? `Search ${label.toLowerCase()}…`}
                autoComplete="off"
                // A phone keyboard that capitalises every client name makes the
                // search miss on the second character.
                autoCapitalize="none"
                spellCheck={false}
              />
              <button className="btn ghost picker-close" onClick={() => setOpen(false)}>Close</button>
            </div>
            <ul className="picker-list" ref={listRef}>
              {rows.map((row, i) => (
                <li key={row.key}>
                  <button
                    type="button"
                    className={`picker-row ${i === active ? 'active' : ''} ${row.kind === 'create' ? 'create' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(row)}
                  >
                    {row.kind === 'create' && (
                      <span className="picker-row-main">
                        <strong>+ {createLabel ?? 'Create'} “{trimmed}”</strong>
                      </span>
                    )}
                    {row.kind === 'none' && <span className="picker-row-main">{noneLabel}</span>}
                    {row.option && (
                      <>
                        {row.option.color && <span className="chip-dot" style={{ background: row.option.color }} />}
                        <span className="picker-row-main">{row.option.label}</span>
                        {row.option.hint && <span className="picker-row-hint">{row.option.hint}</span>}
                        {row.option.id === value && <span className="picker-tick" aria-hidden="true">✓</span>}
                      </>
                    )}
                  </button>
                </li>
              ))}
              {rows.length === 0 && (
                <li className="picker-empty">Nothing matches “{trimmed}”.</li>
              )}
            </ul>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
