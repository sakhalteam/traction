# traction

Client tracker · time tracker · invoice generator — one tool for a solo trade
(landscaping / pressure washing). Part of the [sakhalteam](https://sakhalteam.github.io/) galaxy.

Track your hours against a **service** (reusable, e.g. "Deck cleanup") and an optional
**client**, at a rate you can override per job. When a client asks for an invoice, pick
the client + date range and traction breaks the work out **by day → by service**, with
per-day subtotals and a grand total, ready to print or Save-as-PDF.

## Concepts

- **Service** — a reusable *type* of work with a default $/hr. Global, never owned by a
  client (so "Deck cleanup" is available to everyone). The client-specific detail lives on
  the entry's client + note (e.g. note = "south side rock wall").
- **Time entry** — one chunk of tracked work: `service + client(optional) + date + duration
  + rate + note`. The timer produces these; you can also add them manually. The rate is
  **snapshotted** when logged, so changing a service's rate later never rewrites old invoices.
- **Invoice** — a frozen selection of unbilled entries for one client. Entries get marked
  `invoiced` so they can't be double-billed.

## Stack

Vite 8 + React 19 + TypeScript 6 + Tailwind v4 (plugin). Supabase for cross-device sync
(GitHub OAuth, one JSON row per user, localStorage-first). `base: '/traction/'`.
Deploys to `sakhalteam.github.io/traction/` via GitHub Actions.

## Setup

1. `npm install`
2. Create a Supabase project. In the SQL editor, run [`supabase-setup.sql`](./supabase-setup.sql).
3. Enable the **GitHub** auth provider in Supabase (Authentication → Providers), and add
   `https://sakhalteam.github.io/traction/` plus `http://localhost:5173/traction/` as
   redirect URLs.
4. Copy `.env.example` → `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Add those same two as **repo secrets** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
   so the deploy build can read them.
6. `npm run dev`

Without sign-in the app still works fully — data just lives in this browser's localStorage.
Sign in to sync across your laptop and PC.
