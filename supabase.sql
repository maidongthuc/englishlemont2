-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again: it keeps the data that is already there.
--
-- Who sees what (people sign in with Google):
--   Library notebooks: everyone who is signed in can open and learn them; only admins can change them.
--   My notebooks:      each person's own notebooks; only they can see and change them.
--   Progress:          each person has their own Learn / Listen / Speak progress, also on Library notebooks.

-- ===== Admins =====
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security;  -- no policies: only is_admin() below reads it

-- >>> Put the Gmail address of the admin here (add more lines for more admins) <<<
insert into public.admins (email) values ('maidongthuc2021@gmail.com') on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ===== Notebooks =====
create table if not exists public.notebooks (
  id text primary key,
  kind text not null default 'notebook',
  name text not null,
  color text,
  created_at bigint,          -- milliseconds since 1970, as the page stores it
  position int not null default 0
);
alter table public.notebooks add column if not exists owner_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.notebooks add column if not exists is_library boolean not null default false;
-- Notebooks from before sign-in existed have no owner: they become the Library
update public.notebooks set is_library = true where owner_id is null and not is_library;
create index if not exists notebooks_owner_id_idx on public.notebooks (owner_id);

-- ===== Sentences =====
create table if not exists public.items (
  id text primary key,
  notebook_id text not null references public.notebooks (id) on delete cascade,
  term text not null,
  meaning text not null default '',
  created_at bigint,
  position int not null default 0
);
create index if not exists items_notebook_id_idx on public.items (notebook_id);
-- Progress used to be stored on the sentence. It is kept as legacy_progress and shown to admins
-- until an admin saves once; then it moves into the progress table below.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'items' and column_name = 'progress') then
    alter table public.items rename column progress to legacy_progress;
  end if;
end $$;
alter table public.items add column if not exists legacy_progress jsonb;

-- ===== Progress (one row per person per sentence) =====
create table if not exists public.progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id text not null references public.items (id) on delete cascade,
  progress jsonb not null,    -- e.g. {"meaning": "done", "listen": "wrong", "speak": "done"}
  primary key (user_id, item_id)
);
create index if not exists progress_item_id_idx on public.progress (item_id);

-- ===== Access rules =====
alter table public.notebooks enable row level security;
alter table public.items enable row level security;
alter table public.progress enable row level security;

-- The old rules let anyone with the key read and write everything
drop policy if exists "app can read and write" on public.notebooks;
drop policy if exists "app can read and write" on public.items;
drop table if exists public.app_data;

drop policy if exists "read library and own notebooks" on public.notebooks;
create policy "read library and own notebooks" on public.notebooks
  for select to authenticated
  using (is_library or owner_id = auth.uid());

drop policy if exists "change own notebooks, admins change library" on public.notebooks;
create policy "change own notebooks, admins change library" on public.notebooks
  for all to authenticated
  using ((is_library and public.is_admin()) or (not is_library and owner_id = auth.uid()))
  with check ((is_library and public.is_admin()) or (not is_library and owner_id = auth.uid()));

drop policy if exists "read sentences of readable notebooks" on public.items;
create policy "read sentences of readable notebooks" on public.items
  for select to authenticated
  using (exists (select 1 from public.notebooks n where n.id = notebook_id));

drop policy if exists "change sentences of editable notebooks" on public.items;
create policy "change sentences of editable notebooks" on public.items
  for all to authenticated
  using (exists (select 1 from public.notebooks n where n.id = notebook_id
                 and ((n.is_library and public.is_admin()) or (not n.is_library and n.owner_id = auth.uid()))))
  with check (exists (select 1 from public.notebooks n where n.id = notebook_id
                      and ((n.is_library and public.is_admin()) or (not n.is_library and n.owner_id = auth.uid()))));

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== What the app calls =====
-- {"isAdmin": bool, "books": [...], "items": [...]}: the Library, the person's own notebooks,
-- their sentences, and this person's progress on each sentence
drop function if exists public.load_app_data();
create function public.load_app_data()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'isAdmin', public.is_admin(),
    'books', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'name', n.name, 'color', n.color, 'createdAt', n.created_at,
        'library', n.is_library
      )) order by n.position, n.id)
      from public.notebooks n
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', i.id, 'notebookId', i.notebook_id, 'term', i.term, 'meaning', i.meaning,
        'progress', coalesce(p.progress, case when public.is_admin() then i.legacy_progress end),
        'createdAt', i.created_at
      )) order by i.position, i.id)
      from public.items i
      left join public.progress p on p.item_id = i.id and p.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

-- The page sends everything it shows. Notebooks and sentences the person may change are added,
-- updated or deleted to match; the rest (the Library, for non-admins) is left alone.
-- Progress is saved for this person only. Runs as one transaction: a failed save changes nothing.
drop function if exists public.save_app_data(jsonb, jsonb);
create function public.save_app_data(p_books jsonb, p_items jsonb)
returns void
language plpgsql
as $$
declare
  admin boolean := public.is_admin();
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  insert into public.notebooks (id, kind, name, color, created_at, position, is_library, owner_id)
  select b->>'id', coalesce(b->>'kind', 'notebook'), coalesce(b->>'name', ''), b->>'color',
         (b->>'createdAt')::bigint, ord, coalesce((b->>'library')::boolean, false), auth.uid()
  from jsonb_array_elements(p_books) with ordinality as t(b, ord)
  where b->>'id' is not null and (not coalesce((b->>'library')::boolean, false) or admin)
  on conflict (id) do update set
    kind = excluded.kind, name = excluded.name, color = excluded.color,
    created_at = excluded.created_at, position = excluded.position;

  -- Row level security limits both deletes to what this person may change
  delete from public.items
  where id not in (select x->>'id' from jsonb_array_elements(p_items) x where x->>'id' is not null)
    and exists (select 1 from public.notebooks n where n.id = notebook_id
                and ((n.is_library and admin) or (not n.is_library and n.owner_id = auth.uid())));

  delete from public.notebooks n
  where n.id not in (select b->>'id' from jsonb_array_elements(p_books) b where b->>'id' is not null)
    and ((n.is_library and admin) or (not n.is_library and n.owner_id = auth.uid()));

  insert into public.items (id, notebook_id, term, meaning, created_at, position)
  select i->>'id', i->>'notebookId', coalesce(i->>'term', ''), coalesce(i->>'meaning', ''),
         (i->>'createdAt')::bigint, ord
  from jsonb_array_elements(p_items) with ordinality as t(i, ord)
  join public.notebooks n on n.id = i->>'notebookId'
  where (n.is_library and admin) or (not n.is_library and n.owner_id = auth.uid())
  on conflict (id) do update set
    notebook_id = excluded.notebook_id, term = excluded.term, meaning = excluded.meaning,
    created_at = excluded.created_at, position = excluded.position;

  insert into public.progress (user_id, item_id, progress)
  select auth.uid(), i->>'id', i->'progress'
  from jsonb_array_elements(p_items) i
  where jsonb_typeof(i->'progress') = 'object' and i->'progress' <> '{}'::jsonb
    and exists (select 1 from public.items x where x.id = i->>'id')
  on conflict (user_id, item_id) do update set progress = excluded.progress;

  -- Progress that is no longer sent was reset
  delete from public.progress p
  where p.user_id = auth.uid()
    and p.item_id not in (
      select i->>'id' from jsonb_array_elements(p_items) i
      where jsonb_typeof(i->'progress') = 'object' and i->'progress' <> '{}'::jsonb
    );

  -- An admin's first save has moved the old progress into the progress table
  if admin then
    update public.items set legacy_progress = null where legacy_progress is not null;
  end if;
end;
$$;
