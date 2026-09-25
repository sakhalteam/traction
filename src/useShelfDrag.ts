import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Dragging material on and off the shelf, on a phone and on a desktop.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which does not fire
 * on touch at all — and the shelf is used one-handed in somebody's yard far
 * more often than at a desk.
 *
 * `dragHandle` is spread onto a small grip, never onto a whole row. The row
 * used to be the grip, which meant a finger had to HOLD before lifting (so a
 * swipe could still scroll the list), and on iOS that same hold also started a
 * text selection on the row's label: one gesture, two things happening. A
 * grip is marked `touch-action: none` and has no text, so it is never a scroll
 * and never a selection — any pointer lifts after a few pixels of movement.
 */

/** Where a dragged expense can be let go. */
export type DropTarget =
  | { kind: 'shelf' }
  | { kind: 'billable' }
  /** Onto a specific sibling, to put the two back together. */
  | { kind: 'merge'; id: string }

export interface DragState {
  /** The expense being dragged, or null when nothing is lifted. */
  id: string | null
  /** Viewport position of the pointer, for drawing the thing under the finger. */
  x: number
  y: number
  target: DropTarget | null
}

const IDLE: DragState = { id: null, x: 0, y: 0, target: null }

/** How far a pointer moves before a press on the grip becomes a drag. A tap is
 *  not a drag, and this is what tells the two apart. */
const LIFT_SLOP = 5

function targetAt(x: number, y: number, draggingId: string): DropTarget | null {
  const el = document.elementFromPoint(x, y)
  const zone = el?.closest<HTMLElement>('[data-drop]')
  if (!zone) return null
  const kind = zone.dataset.drop
  if (kind === 'merge') {
    const id = zone.dataset.dropId
    // Landing back on yourself is how every aborted drag ends. Never a merge.
    return id && id !== draggingId ? { kind: 'merge', id } : null
  }
  if (kind === 'shelf') return { kind: 'shelf' }
  if (kind === 'billable') return { kind: 'billable' }
  return null
}

export function useShelfDrag(onDrop: (id: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState>(IDLE)
  /**
   * The live gesture. Kept in a ref rather than state because pointermove fires
   * far faster than React can re-render, and a stale closure mid-drag reads as
   * the item snapping back to where it was picked up.
   */
  const gesture = useRef<{
    id: string
    startX: number
    startY: number
    lifted: boolean
  } | null>(null)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  /**
   * The live drag, mirrored outside React state.
   *
   * `end` needs to know what was under the pointer at the moment of release,
   * and reading that from inside a `setDrag` updater would mean firing the drop
   * from a function React is free to call more than once — which StrictMode
   * does on every update, turning one drop into two.
   */
  const latest = useRef<DragState>(IDLE)
  const commitDrag = (next: DragState) => { latest.current = next; setDrag(next) }

  const end = useCallback((commit: boolean) => {
    const g = gesture.current
    const { id, target } = latest.current
    gesture.current = null
    commitDrag(IDLE)
    if (commit && g?.lifted && id && target) onDropRef.current(id, target)
  }, [])

  useEffect(() => {
    if (!drag.id) return
    // pointermove alone cannot stop a touch scroll: the browser has already
    // decided by then. A non-passive touchmove listener is the only thing that
    // reliably keeps the page still while something is in the air.
    const block = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    // Nothing on the page may start selecting while an item is in the air — a
    // finger dragged across a label is a drag, not a highlight.
    document.body.classList.add('drag-in-flight')
    return () => {
      document.removeEventListener('touchmove', block)
      document.body.classList.remove('drag-in-flight')
    }
  }, [drag.id])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const far = Math.hypot(dx, dy)

      if (!g.lifted) {
        if (far < LIFT_SLOP) return
        g.lifted = true
        // Confirms the lift in the hand, since a finger has no cursor to change.
        if (e.pointerType !== 'mouse') navigator.vibrate?.(12)
      }
      commitDrag({ id: g.id, x: e.clientX, y: e.clientY, target: targetAt(e.clientX, e.clientY, g.id) })
    }
    const up = () => end(true)
    const cancel = () => end(false)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') end(false) }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [end])

  /** Spread onto the grip — see the note at the top of this file. */
  const dragHandle = useCallback((id: string) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      // Keeps iOS from treating the press as the start of a text selection or
      // a long-press callout on the way to becoming a drag.
      e.preventDefault()
      gesture.current = { id, startX: e.clientX, startY: e.clientY, lifted: false }
    },
  }), [])

  return { drag, dragHandle, dragging: drag.id !== null }
}
