-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run
-- Notebooks and sentences each get their own table. The app reads and saves them through
-- load_app_data() and save_app_data(), which keep the same JSON shape the page uses.

create table if not exists public.notebooks (
  id text primary key,
  kind text not null default 'notebook',
  name text not null,
  color text,
  created_at bigint,          -- milliseconds since 1970, as the page stores it
  position int not null default 0
);

create table if not exists public.items (
  id text primary key,
  notebook_id text not null references public.notebooks (id) on delete cascade,
  term text not null,
  meaning text not null default '',
  progress jsonb,             -- e.g. {"meaning": "done", "listen": "wrong", "speak": "done"}
  created_at bigint,
  position int not null default 0
);

create index if not exists items_notebook_id_idx on public.items (notebook_id);

alter table public.notebooks enable row level security;
alter table public.items enable row level security;

-- Needed only when SUPABASE_KEY is the publishable (anon) key.
-- With the secret key (sb_secret_...) you can skip this: it bypasses row level security.
-- Note: anyone who has the publishable key can then read and change these tables.
drop policy if exists "app can read and write" on public.notebooks;
create policy "app can read and write" on public.notebooks
  for all to anon using (true) with check (true);
drop policy if exists "app can read and write" on public.items;
create policy "app can read and write" on public.items
  for all to anon using (true) with check (true);

-- Everything as {"books": [...], "items": [...]} in one call (a plain table read stops at 1000 rows)
create or replace function public.load_app_data()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'books', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'kind', kind, 'name', name, 'color', color, 'createdAt', created_at
      )) order by position, id)
      from public.notebooks
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'notebookId', notebook_id, 'term', term, 'meaning', meaning,
        'progress', progress, 'createdAt', created_at
      )) order by position, id)
      from public.items
    ), '[]'::jsonb)
  );
$$;

-- The page always sends the full lists: add or update what is in them, delete what is not.
-- Runs as one transaction, so a failed save changes nothing.
create or replace function public.save_app_data(p_books jsonb, p_items jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.notebooks (id, kind, name, color, created_at, position)
  select b->>'id', coalesce(b->>'kind', 'notebook'), coalesce(b->>'name', ''), b->>'color',
         (b->>'createdAt')::bigint, ord
  from jsonb_array_elements(p_books) with ordinality as t(b, ord)
  on conflict (id) do update set
    kind = excluded.kind, name = excluded.name, color = excluded.color,
    created_at = excluded.created_at, position = excluded.position;

  delete from public.items
  where id not in (select x->>'id' from jsonb_array_elements(p_items) x where x->>'id' is not null);

  delete from public.notebooks
  where id not in (select b->>'id' from jsonb_array_elements(p_books) b where b->>'id' is not null);

  insert into public.items (id, notebook_id, term, meaning, progress, created_at, position)
  select i->>'id', i->>'notebookId', coalesce(i->>'term', ''), coalesce(i->>'meaning', ''),
         nullif(i->'progress', 'null'::jsonb), (i->>'createdAt')::bigint, ord
  from jsonb_array_elements(p_items) with ordinality as t(i, ord)
  on conflict (id) do update set
    notebook_id = excluded.notebook_id, term = excluded.term, meaning = excluded.meaning,
    progress = excluded.progress, created_at = excluded.created_at, position = excluded.position;
end;
$$;

-- The earlier single-row table is no longer used
drop table if exists public.app_data;
