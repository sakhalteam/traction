-- traction — Supabase setup
-- Run this once in the Supabase SQL editor for the project whose URL/anon key
-- you put in .env (and in the GitHub repo secrets).
--
-- One row per user holds the whole app state as JSON, mirroring adhdo's
-- galaxy_states pattern. RLS keeps each user's data private to themselves.

create table if not exists public.traction_states (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  state_json  jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.traction_states enable row level security;

-- Owners can do anything to their own row; nobody can touch anyone else's.
drop policy if exists "own rows - select" on public.traction_states;
create policy "own rows - select" on public.traction_states
  for select using (auth.uid() = user_id);

drop policy if exists "own rows - insert" on public.traction_states;
create policy "own rows - insert" on public.traction_states
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows - update" on public.traction_states;
create policy "own rows - update" on public.traction_states
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows - delete" on public.traction_states;
create policy "own rows - delete" on public.traction_states
  for delete using (auth.uid() = user_id);

-- Explicit grants (harmless before, required after Supabase's Oct 30 2026 change
-- where new public-schema tables no longer inherit default role grants).
grant select, insert, update, delete on public.traction_states to authenticated;


-- ---------------------------------------------------------------------------
-- Receipt photos
-- ---------------------------------------------------------------------------
-- Expense receipts live in Storage, NOT in state_json. The whole app state is
-- upserted as one JSON blob on every debounced save, so inlining image bytes
-- would re-upload every receipt on every keystroke. Only the object path is
-- stored on the expense (Expense.receiptPath).
--
-- Objects are keyed `<user_id>/<expenseId>-<timestamp>.jpg`, so the first path
-- segment is the owner and every policy below checks it against auth.uid().

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Private bucket: reads go through short-lived signed URLs, never public links.
drop policy if exists "receipts - own read" on storage.objects;
create policy "receipts - own read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "receipts - own insert" on storage.objects;
create policy "receipts - own insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "receipts - own update" on storage.objects;
create policy "receipts - own update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "receipts - own delete" on storage.objects;
create policy "receipts - own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
