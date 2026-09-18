import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Dragging material on and off the shelf, on a phone and on a desktop.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which does not fire
 * on touch at all — and the shelf is used one-handed in somebody's yard far
 * more often than at a desk.
 *
 * The gesture differs by input because the conflict differs. A mouse has
 * nothing else to do, so a few pixels of movement means a drag. A finger's
 * default job inside a scrolling list is to scroll, so a touch has to be HELD
 * first: move early and it stays a scroll, hold still and the item lifts. Once
 * lifted, page scrolling is suppressed until the finger comes up.
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

/** How long a finger must stay put before the item lifts instead of scrolling. */
const HOLD_MS = 350
/** How far a finger may stray during that hold before we call it a scroll. */
const HOLD_SLOP = 10
/** How far a mouse moves before a press becomes a drag. */
const MOUSE_SLOP = 5

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
    touch: boolean
    holdTimer: number | null
  } | null>(null)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const clearHold = () => {
    const g = gesture.current
    if (g?.holdTimer !== null && g?.holdTimer !== undefined) {
      window.clearTimeout(g.holdTimer)
      g.holdTimer = null
    }
  }

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
    clearHold()
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
    return () => document.removeEventListener('touchmove', block)
  }, [drag.id])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const far = Math.hypot(dx, dy)

      if (!g.lifted) {
        // A finger that wanders before the hold completes was always scrolling.
        if (g.touch) {
          if (far > HOLD_SLOP) { clearHold(); gesture.current = null }
          return
        }
        if (far < MOUSE_SLOP) return
        g.lifted = true
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

  /** Spread onto whatever should be draggable. */
  const dragHandle = useCallback((id: string) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      // Left button only, and never from a control — the row is covered in
      // buttons and a tap on one of them must stay a tap.
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return
      const touch = e.pointerType !== 'mouse'
      const g = {
        id, startX: e.clientX, startY: e.clientY, lifted: !touch, touch, holdTimer: null as number | null,
      }
      gesture.current = g
      if (touch) {
        g.holdTimer = window.setTimeout(() => {
          if (gesture.current !== g) return
          g.lifted = true
          // Confirms the lift in the hand, since there is no cursor to change.
          navigator.vibrate?.(12)
          commitDrag({ id, x: g.startX, y: g.startY, target: null })
        }, HOLD_MS)
      }
    },
  }), [])

  return { drag, dragHandle, dragging: drag.id !== null }
}
