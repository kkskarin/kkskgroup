-- Bills & Vouchers: a Firestore-style document store, so the app keeps its existing data model.
-- Applied to project uqjirmofridjuykeemml on 2026-10-07.
create schema if not exists private;

-- Super admins are the app owners (the artifact's owner/editor level).
create table public.app_super_admins (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
-- Email domains whose people may sign in and use the app (Contributor level).
create table public.app_allowed_domains (
  domain text primary key check (domain = lower(domain))
);
-- Individual addresses outside those domains that may use the app.
create table public.app_allowed_emails (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
insert into public.app_super_admins (email) values ('arin@kksk.in');
insert into public.app_allowed_domains (domain) values ('kksk.in');

alter table public.app_super_admins enable row level security;
alter table public.app_allowed_domains enable row level security;
alter table public.app_allowed_emails enable row level security;

-- Name shown for each person; uid is the id the app stores ("u_" + auth id).
create table public.app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  uid text generated always as ('u_' || replace(user_id::text, '-', '')) stored unique,
  name text not null default '' check (char_length(name) <= 120),
  email text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_profiles enable row level security;

create table public.app_docs (
  path text primary key check (path ~ '^[A-Za-z0-9_.~:@+-]+(/[A-Za-z0-9_.~:@+-]+)*$' and char_length(path) <= 1000),
  collection text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  doc_id text generated always as (regexp_replace(path, '^.*/', '')) stored,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 1048576),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index app_docs_collection_idx on public.app_docs (collection);
alter table public.app_docs enable row level security;
alter table public.app_docs replica identity full;

create or replace function private.jwt_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function private.is_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_super_admins s where s.email = private.jwt_email())
$$;

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.jwt_email() <> '' and (
    private.is_super()
    or exists (select 1 from public.app_allowed_emails e where e.email = private.jwt_email())
    or exists (select 1 from public.app_allowed_domains d where d.domain = split_part(private.jwt_email(), '@', 2))
  )
$$;

create or replace function private.my_uid() returns text
language sql stable set search_path = '' as $$
  select 'u_' || replace(auth.uid()::text, '-', '')
$$;

-- An app admin is someone the super admin named under admins/<uid> (active unless false).
create or replace function private.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_super() or exists (
    select 1 from public.app_docs d
    where d.path = 'admins/' || private.my_uid()
      and coalesce((d.data ->> 'active')::boolean, true)
  )
$$;

-- The write rules the artifact declared:
--   admins/*         only the super admin
--   users/<own uid>  only an admin (people cannot edit their own user record)
--   everything else  any member
create or replace function private.can_write(p text) returns boolean
language sql stable set search_path = '' as $$
  select private.is_member() and case
    when p like 'admins/%' then private.is_super()
    when p = 'users/' || private.my_uid() then private.is_app_admin()
    else true
  end
$$;

create policy "members read docs" on public.app_docs for select to authenticated
  using ((select private.is_member()));
create policy "members insert docs" on public.app_docs for insert to authenticated
  with check (private.can_write(path));
create policy "members update docs" on public.app_docs for update to authenticated
  using (private.can_write(path)) with check (private.can_write(path));
create policy "members delete docs" on public.app_docs for delete to authenticated
  using (private.can_write(path));

create policy "members read profiles" on public.app_profiles for select to authenticated
  using ((select private.is_member()));
create policy "own profile insert" on public.app_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member()));
create policy "own profile update" on public.app_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "members read super admins" on public.app_super_admins for select to authenticated
  using ((select private.is_member()));

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
revoke all on public.app_docs, public.app_profiles, public.app_super_admins, public.app_allowed_domains, public.app_allowed_emails from anon;
grant select, insert, update, delete on public.app_docs to authenticated;
grant select, insert, update on public.app_profiles to authenticated;
grant select on public.app_super_admins to authenticated;

-- Deep merge for doc update(): nested objects merge, anything else replaces.
create or replace function private.jsonb_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; r jsonb := a;
begin
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(r -> k) = 'object' and jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], private.jsonb_merge(r -> k, v));
    else
      r := jsonb_set(r, array[k], v, true);
    end if;
  end loop;
  return r;
end $$;
grant execute on function private.jsonb_merge(jsonb, jsonb) to authenticated;

-- update(): merges into an existing document; false if it does not exist (or is not visible).
create or replace function public.doc_update(p_path text, p_patch jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  update public.app_docs set data = private.jsonb_merge(data, p_patch), updated_at = now(), updated_by = auth.uid()
    where path = p_path;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.doc_update(text, jsonb) from anon, public;
grant execute on function public.doc_update(text, jsonb) to authenticated;

-- Role flags for the signed-in person.
create or replace function public.app_whoami() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('uid', private.my_uid(), 'email', private.jwt_email(),
    'member', private.is_member(), 'super', private.is_super())
$$;
revoke execute on function public.app_whoami() from anon, public;
grant execute on function public.app_whoami() to authenticated;

alter publication supabase_realtime add table public.app_docs;
