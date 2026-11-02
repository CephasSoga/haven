-- Haven: accounts and sync.
-- Paste this whole file into your Supabase project's SQL editor and press Run. Safe to run again.
--
-- Each part of Haven (planner, finances, notes, …) is stored as one JSON document per user.
-- Row-level security means a signed-in user can only ever read or write their own rows.
-- The vault is stored exactly as it is on your devices: already encrypted with your master password.

create table if not exists public.documents (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  device     text,
  primary key (user_id, key)
);

alter table public.documents enable row level security;

drop policy if exists "Users read their own documents" on public.documents;
create policy "Users read their own documents" on public.documents
  for select using (auth.uid() = user_id);

drop policy if exists "Users add their own documents" on public.documents;
create policy "Users add their own documents" on public.documents
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users change their own documents" on public.documents;
create policy "Users change their own documents" on public.documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete their own documents" on public.documents;
create policy "Users delete their own documents" on public.documents
  for delete using (auth.uid() = user_id);

-- Live updates between your devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
  ) then
    alter publication supabase_realtime add table public.documents;
  end if;
end $$;

-- Book files for the Library, in a private bucket: one folder per user.
insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do nothing;

drop policy if exists "Users read their own books" on storage.objects;
create policy "Users read their own books" on storage.objects
  for select using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users add their own books" on storage.objects;
create policy "Users add their own books" on storage.objects
  for insert with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users change their own books" on storage.objects;
create policy "Users change their own books" on storage.objects
  for update using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own books" on storage.objects;
create policy "Users delete their own books" on storage.objects
  for delete using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
