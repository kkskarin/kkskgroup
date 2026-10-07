-- Anyone can create an account; the app's own request-and-approve flow decides who gets in.
-- "Member" now means approved in the app: a super admin, an app admin, or an active users/<uid> record.
-- (app_allowed_domains / app_allowed_emails are no longer used.)

-- Super admins must have confirmed their email, so nobody can claim one by signing up first.
create or replace function private.is_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_super_admins s where s.email = private.jwt_email())
     and exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.is_super()
    or exists (select 1 from public.app_docs d
               where d.path in ('admins/' || private.my_uid(), 'users/' || private.my_uid())
                 and coalesce((d.data ->> 'active')::boolean, true))
  )
$$;

-- What a signed-in person who is not approved yet may read: the lists the request form needs,
-- and their own request and user records.
create or replace function private.pending_can_read(p text, coll text, d jsonb) returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and (
    coll in ('companies', 'locations', 'departments')
    or p in ('requests/' || private.my_uid(), 'users/' || private.my_uid())
    or (coll in ('users', 'requests') and d ->> 'accountedFor' = private.my_uid())
  )
$$;

create or replace function private.can_write(p text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when private.is_member() then case
      when p like 'admins/%' then private.is_super()
      when p = 'users/' || private.my_uid() then private.is_app_admin()
      else true
    end
    -- not approved yet: only their own access request
    else auth.uid() is not null and p = 'requests/' || private.my_uid()
  end
$$;

-- Added alongside the existing member policies (Postgres ORs them together).
create policy "pending read request screen" on public.app_docs for select to authenticated
  using (private.pending_can_read(path, collection, data));
-- The app writes a change-log entry after each save; people not approved yet may add their own.
create policy "pending add own change log" on public.app_docs for insert to authenticated
  with check (path like 'audit/%' and data ->> 'by' = private.my_uid());

create policy "read own profile" on public.app_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "create own profile" on public.app_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "signed in read super admins" on public.app_super_admins for select to authenticated
  using (true);

-- whoami: approved = member; everyone signed in may use the request screen.
create or replace function public.app_whoami() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('uid', private.my_uid(), 'email', private.jwt_email(),
    'signedIn', auth.uid() is not null, 'member', private.is_member(), 'super', private.is_super())
$$;

grant execute on all functions in schema private to authenticated;
