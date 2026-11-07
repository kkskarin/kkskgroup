-- KKSK Group: tighter write rules in the database (the app already enforces these on screen).
--   users/*      only admins (the Super Admin and app admins), plus a shared login's own profiles (users/<p> whose accountedFor is me).
--   roledefs/*   only admins.
--   tly__*       Tally (Demo): only the Super Admin and the Chief Accountant.
--   audit/*      the change log can be added to, never changed or removed, except by an admin.
--   admins/*     only the Super Admin (unchanged).

create or replace function private.my_user_doc() returns jsonb
language sql stable security definer set search_path = '' as $$
  select d.data from public.app_docs d where d.path = 'users/' || private.my_uid()
$$;
revoke execute on function private.my_user_doc() from anon, public;
grant execute on function private.my_user_doc() to authenticated;

create or replace function private.me_is_chief() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(private.is_chief(private.my_user_doc()), false)
$$;
revoke execute on function private.me_is_chief() from anon, public;
grant execute on function private.me_is_chief() to authenticated;

create or replace function private.is_my_profile(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_docs d where d.path = p and d.data ->> 'accountedFor' = private.my_uid())
$$;
revoke execute on function private.is_my_profile(text) from anon, public;
grant execute on function private.is_my_profile(text) to authenticated;

create or replace function private.can_write(p text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when private.is_member() then case
      when p like 'admins/%' then private.is_super()
      when p like 'users/%' then private.is_app_admin() or (p <> 'users/' || private.my_uid() and private.is_my_profile(p))
      when p like 'roledefs/%' then private.is_app_admin()
      when p like 'tly\_\_%' then private.is_super() or private.me_is_chief()
      else true
    end
    -- not approved yet: only their own access request
    else auth.uid() is not null and p = 'requests/' || private.my_uid()
  end
$$;

-- the change log is append-only for everyone but admins
drop policy if exists "members update docs" on public.app_docs;
create policy "members update docs" on public.app_docs for update to authenticated
  using (private.can_write(path) and (path not like 'audit/%' or private.is_app_admin()))
  with check (private.can_write(path) and (path not like 'audit/%' or private.is_app_admin()));
drop policy if exists "members delete docs" on public.app_docs;
create policy "members delete docs" on public.app_docs for delete to authenticated
  using (private.can_write(path) and (path not like 'companies/%' or private.is_app_admin()) and (path not like 'audit/%' or private.is_app_admin()));
