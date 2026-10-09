-- KKSK Group: one sign-in for several apps.
--   * app_portal(): what the signed-in person may open (Bills & Vouchers, Production Planning) and as what.
--     Production Planning's own project asks this, with the person's token, before letting them in.
--   * Bills & Vouchers data is for people given Bills & Vouchers (users/<uid>.apps.bv, true unless set false),
--     admins and super admins.
--   * Super admins manage other super admins; the last one cannot be removed.

-- Approved for Bills & Vouchers: super admin, app admin, or an active user record not turned off for Bills & Vouchers.
create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.is_super()
    or exists (select 1 from public.app_docs d
               where d.path = 'admins/' || private.my_uid()
                 and coalesce((d.data ->> 'active')::boolean, true))
    or exists (select 1 from public.app_docs d
               where d.path = 'users/' || private.my_uid()
                 and coalesce((d.data ->> 'active')::boolean, true)
                 and coalesce((d.data -> 'apps' ->> 'bv')::boolean, true))
  )
$$;

create or replace function public.app_portal() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid text := private.my_uid();
  v_super boolean := private.is_super();
  v_admin boolean;
  v_user jsonb;
  v_name text;
  v_pp jsonb;
  v_bv boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('signedIn', false);
  end if;
  select coalesce((d.data ->> 'active')::boolean, true) into v_admin from public.app_docs d where d.path = 'admins/' || v_uid;
  v_admin := v_super or coalesce(v_admin, false);
  select d.data into v_user from public.app_docs d where d.path = 'users/' || v_uid;
  if v_user is not null and not coalesce((v_user ->> 'active')::boolean, true) then v_user := null; end if;
  select p.name into v_name from public.app_profiles p where p.user_id = auth.uid();
  if v_admin then
    v_bv := true;
    v_pp := jsonb_build_object('role', case when v_super then 'super_admin' else 'admin' end, 'region', null);
  elsif v_user is not null then
    v_bv := coalesce((v_user -> 'apps' ->> 'bv')::boolean, true);
    v_pp := case when coalesce(v_user -> 'apps' -> 'pp' ->> 'role', '') in ('approver', 'planner', 'floor')
                 then jsonb_build_object('role', v_user -> 'apps' -> 'pp' ->> 'role',
                                         'region', nullif(v_user -> 'apps' -> 'pp' ->> 'region', ''))
                 else null end;
  else
    v_bv := false; v_pp := null;
  end if;
  return jsonb_build_object(
    'signedIn', true, 'uid', v_uid, 'email', private.jwt_email(),
    'name', coalesce(nullif(v_user ->> 'name', ''), v_name, ''),
    'super', v_super, 'admin', v_admin, 'approved', v_admin or v_user is not null,
    'apps', jsonb_build_object('bv', v_bv, 'pp', v_pp));
end $$;
revoke execute on function public.app_portal() from anon, public;
grant execute on function public.app_portal() to authenticated;

-- Super admins, managed only by super admins.
create or replace function public.super_admins_list() returns table (email text, name text, has_login boolean, confirmed boolean, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super() then raise exception 'Only a super admin can see this' using errcode = '42501'; end if;
  return query
    select s.email, coalesce(p.name, ''), u.id is not null, u.email_confirmed_at is not null, s.added_at
      from public.app_super_admins s
      left join auth.users u on lower(u.email) = s.email
      left join public.app_profiles p on p.user_id = u.id
     order by s.added_at;
end $$;

create or replace function public.super_admin_add(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := lower(trim(coalesce(p_email, '')));
begin
  if not private.is_super() then raise exception 'Only a super admin can add a super admin' using errcode = '42501'; end if;
  if v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
  insert into public.app_super_admins (email) values (v) on conflict (email) do nothing;
end $$;

create or replace function public.super_admin_remove(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := lower(trim(coalesce(p_email, ''))); v_left int;
begin
  if not private.is_super() then raise exception 'Only a super admin can remove a super admin' using errcode = '42501'; end if;
  -- Someone confirmed must stay, so the app can never be left without a super admin.
  select count(*) into v_left
    from public.app_super_admins s join auth.users u on lower(u.email) = s.email
   where s.email <> v and u.email_confirmed_at is not null;
  if v_left = 0 then raise exception 'The last super admin cannot be removed' using errcode = '22023'; end if;
  delete from public.app_super_admins where email = v;
end $$;

revoke execute on function public.super_admins_list(), public.super_admin_add(text), public.super_admin_remove(text) from anon, public;
grant execute on function public.super_admins_list(), public.super_admin_add(text), public.super_admin_remove(text) to authenticated;
