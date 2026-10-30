-- Trial App (/inv): public, no sign-in. Its masters and daily entries live in their own table, apart from app_docs, and
-- anyone with the link may read and change them (chosen deliberately: "online, shared, fully open").
--   masters/<tab>/<sub>        { items: [{ id, name }] }            the stages for one location (in order)
--   entry/<tab>/<sub>/<date>   { date, cells: { <masterId>: { dom, imp } }, updatedAt }   pieces at each stage that day
create table if not exists public.trial_docs (
  path text primary key check (path ~ '^[a-z0-9_-]+(/[A-Za-z0-9_-]+){1,4}$' and char_length(path) <= 200),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  updated_at timestamptz not null default now()
);
alter table public.trial_docs enable row level security;
create policy "trial app: anyone reads" on public.trial_docs for select to anon, authenticated using (true);
create policy "trial app: anyone adds" on public.trial_docs for insert to anon, authenticated with check (true);
create policy "trial app: anyone changes" on public.trial_docs for update to anon, authenticated using (true) with check (true);
create policy "trial app: anyone removes" on public.trial_docs for delete to anon, authenticated using (true);
grant select, insert, update, delete on public.trial_docs to anon, authenticated;

-- Raw to WB masters for Erode, Ambur and Ranipet, in order.
insert into public.trial_docs (path, data)
select 'masters/raw/' || loc, jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('id', 'rawhide', 'name', 'Rawhide'),
  jsonb_build_object('id', 'liming', 'name', 'Liming / Tanning'),
  jsonb_build_object('id', 'pickling', 'name', 'Pickling'),
  jsonb_build_object('id', 'wbfresh', 'name', 'WB Fresh Lot'),
  jsonb_build_object('id', 'wwfresh', 'name', 'WW Fresh Lot')))
from unnest(array['erode', 'ambur', 'ranipet']) as loc
on conflict (path) do nothing;
