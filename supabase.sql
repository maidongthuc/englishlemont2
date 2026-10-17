-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run
-- The app keeps all notebooks and sentences as one JSON document in the row id = 'main'.
create table if not exists public.app_data (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

-- Needed only when SUPABASE_KEY is the publishable (anon) key.
-- With the secret key (sb_secret_...) you can skip this: it bypasses row level security.
-- Note: anyone who has the publishable key can then read and change this table.
drop policy if exists "app can read and write" on public.app_data;
create policy "app can read and write" on public.app_data
  for all to anon using (true) with check (true);
