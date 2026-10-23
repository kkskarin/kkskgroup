-- Settings › Show Activity is also open to Chief Accountants (job "chiefacct"). Same function as 20261023150000.
-- Settings › Show Activity (admins only): per login, the last sign-in, the last time the app was in use (a session
-- refresh), the last edit and how many edits since a date. Edits come from the Change Log (audit/*, every change by
-- anyone) and from the last writer of each record; personal settings, the change log itself and Demo data don't count.
create or replace function public.app_activity(p_since bigint default 0)
returns table (uid text, last_sign_in timestamptz, last_active timestamptz, last_edit timestamptz, edits bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_app_admin() or exists (select 1 from public.app_docs d where d.path = 'users/' || private.my_uid()
                                               and coalesce((d.data ->> 'active')::boolean, true) and private.is_chief(d.data))) then
    raise exception 'Only admins can see activity' using errcode = '42501';
  end if;
  return query
  with logins as (
    select u.id, 'u_' || replace(u.id::text, '-', '') as uid, u.last_sign_in_at
      from auth.users u
  ), sess as (
    select s.user_id, max(greatest(s.created_at, coalesce(s.refreshed_at, s.created_at), coalesce(s.updated_at, s.created_at))) as at
      from auth.sessions s group by s.user_id
  ), writes as (
    select d.updated_by, max(d.updated_at) as at
      from public.app_docs d
     where d.updated_by is not null
       and d.path not like 'prefs/%' and d.path not like 'audit/%'
       and d.path not like 'demo\_\_%' and d.path not like 'wbdemo\_%'
     group by d.updated_by
  ), changes as (
    select d.data->>'by' as uid, max((d.data->>'at')::bigint) as at,
           count(*) filter (where (d.data->>'at')::bigint >= coalesce(p_since, 0)) as n
      from public.app_docs d
     where d.path like 'audit/%' and (d.data->>'at') ~ '^\d+$'
     group by d.data->>'by'
  )
  select l.uid, l.last_sign_in_at, coalesce(se.at, l.last_sign_in_at),
         nullif(greatest(coalesce(w.at, '-infinity'::timestamptz), coalesce(to_timestamp(c.at / 1000.0), '-infinity'::timestamptz)), '-infinity'::timestamptz),
         coalesce(c.n, 0)
    from logins l
    left join sess se on se.user_id = l.id
    left join writes w on w.updated_by = l.id
    left join changes c on c.uid = l.uid;
end;
$$;
revoke all on function public.app_activity(bigint) from public, anon;
grant execute on function public.app_activity(bigint) to authenticated;
