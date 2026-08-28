import type { ReactNode } from 'react'

/**
 * Line-art glyphs for the kinds of work traction bills for.
 *
 * Stroked, never filled, on a 24x24 grid at a single weight — the same
 * language as the thin rules and bars on the invoice, and the only style that
 * survives being printed in black at 14px. Everything is `currentColor`, so a
 * glyph is whatever colour the text beside it is.
 *
 * Matched on the service NAME rather than an id, because services are Nic's to
 * rename and delete: an id map would silently lose its icon the first time a
 * service was recreated. Anything unrecognised gets the neutral mark, which is
 * a real outcome and not a failure — a new service is still perfectly billable.
 */

const P = (d: string) => <path d={d} />

const GLYPHS: Record<string, ReactNode> = {
  // Sprout: two leaves off a stem.
  gardening: <>{P('M12 21v-8')}{P('M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z')}{P('M12 13c3 0 5-2 5-5-3 0-5 2-5 5z')}</>,
  // Pitched roof with run-off beneath it.
  roofcleaning: <>{P('M3 12l9-7 9 7')}{P('M6 12v3')}{P('M18 12v3')}{P('M9 18v2')}{P('M12 19v2')}{P('M15 18v2')}</>,
  // Decking boards with staggered joins — a plain grid read as a table.
  deckrepair: <>{P('M3 6h18')}{P('M3 12h18')}{P('M3 18h18')}{P('M9 6v6')}{P('M15 12v6')}</>,
  // Nozzle throwing a fan of spray.
  pressurewashing: <>{P('M3 12h7l4-3v6l-4-3')}{P('M16 7l4-2')}{P('M16 12h5')}{P('M16 17l4 2')}</>,
  // Spent bloom being snipped off.
  deadheading: <>{P('M9 9m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0')}{P('M9 12v9')}{P('M15 5l5 5')}{P('M20 5l-5 5')}</>,
  // Waste sack.
  cleanup: <>{P('M6 8h12l-1 12H7z')}{P('M9 8a3 3 0 0 1 6 0')}{P('M10 12v4')}{P('M14 12v4')}</>,
  // Shears.
  pruning: <>{P('M8 5l8 11')}{P('M16 5L8 16')}{P('M6.5 18.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}{P('M17.5 18.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}</>,
  // Gutter channel clearing debris.
  guttercleaning: <>{P('M3 9h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')}{P('M8 4l2 4')}{P('M16 4l-2 4')}{P('M12 18v3')}</>,
  // Stepping stones climbing away.
  pathcreation: <>{P('M3 19h6l-1-3H4z')}{P('M9 14h6l-1-3h-4z')}{P('M15 9h6l-1-3h-4z')}</>,
  // Planted ground: a mound and a tree.
  landscaping: <>{P('M3 19h18')}{P('M3 16c3-6 7-6 9 0')}{P('M18 16v-3')}{P('M18 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0')}</>,
  // Plant in a pot.
  potting: <>{P('M6 12h12l-1.5 8h-9z')}{P('M12 12V8')}{P('M12 9c-2 0-3-1-3-3 2 0 3 1 3 3z')}{P('M12 9c2 0 3-1 3-3-2 0-3 1-3 3z')}</>,
  // Seedling going into the ground.
  planting: <>{P('M3 18h18')}{P('M12 18v-5')}{P('M12 13c2 0 3-1 3-3-2 0-3 1-3 3z')}{P('M12 13c-2 0-3-1-3-3 2 0 3 1 3 3z')}{P('M6 21h2')}{P('M16 21h2')}</>,
  // Loaded truck.
  dumprun: <>{P('M2 16V6h12v10')}{P('M14 16V9h4l3 4v3')}{P('M6.5 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}{P('M17.5 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}</>,
  // Picket fence.
  fencestaining: <>{P('M6 21V7l1.5-2L9 7v14')}{P('M15 21V7l1.5-2L18 7v14')}{P('M3 11h18')}{P('M3 16h18')}</>,
  // Nut and bolt.
  repair: <>{P('M12 3l7 4v10l-7 4-7-4V7z')}{P('M12 9m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0')}</>,
  // Sprinkler throwing an arc.
  irrigation: <>{P('M12 21v-7')}{P('M9 21h6')}{P('M6 12a6 6 0 0 1 12 0')}{P('M3 9V7')}{P('M21 9V7')}{P('M12 5V3')}</>,
  // Paint roller.
  painting: <>{P('M9 4h11v6H9z')}{P('M9 7H4v4h11')}{P('M15 11v3H7v7')}</>,
  // Checklist.
  choreserrands: <>{P('M4 4h16v16H4z')}{P('M8 10l2 2 4-4')}{P('M8 16h8')}</>,
}

/** Neutral mark for a service with no glyph of its own. */
const FALLBACK = <>{P('M12 6v12')}{P('M6 12h12')}</>

/** Strip a service name down to a lookup key: "Gutter Cleaning" -> guttercleaning. */
function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function glyphFor(name: string): ReactNode {
  const k = key(name)
  if (GLYPHS[k]) return GLYPHS[k]
  // A rename like "Gardening & Beds" should keep the gardening leaf rather than
  // dropping to the fallback, so fall back to the longest key it contains.
  const partial = Object.keys(GLYPHS)
    .filter(g => k.includes(g) || g.includes(k))
    .sort((a, b) => b.length - a.length)[0]
  return partial ? GLYPHS[partial] : FALLBACK
}

export function ServiceIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round"
    >
      {glyphFor(name)}
    </svg>
  )
}
