-- Roles (roledefs/*) given to people (users/<id>.roleIds: [{id, until: 'YYYY-MM-DD' | null}]) put their access on the user
-- record. The app keeps it in step while an admin has a page open; this keeps it in step on the server too, so a temporary
-- role also stops on the KKSK Group home (app_portal) the day after its last day, even if no admin opens the app.
-- Same rules as roleEff()/rolePatch() in web/bills/index.html. A record is written only when something differs.
create extension if not exists pg_cron;

create or replace function private.apply_user_roles()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_jobs text[] := array['purchaser', 'accountant', 'chiefacct', 'approver', 'recorder', 'vmaker', 'financier', 'solar'];
  v_apof text[] := array['bcr', 'acr', 'vcr'];
  v_steps text[] := array['acct', 'bills', 'bcr', 'vouchers', 'vcr', 'cash', 'adv', 'appr', 'rec', 'txn', 'solar'];
  u record;
  v_roles jsonb[];
  v_bv boolean; v_div jsonb; v_reco boolean; v_jr jsonb; v_ao jsonb; v_cos jsonb; v_map jsonb; v_until text; v_apps jsonb;
  v_n integer := 0;
begin
  for u in select d.path, d.data from public.app_docs d
           where d.path like 'users/%' and jsonb_typeof(d.data -> 'roleIds') = 'array' and jsonb_array_length(d.data -> 'roleIds') > 0
  loop
    select coalesce(array_agg(r.data), '{}'), min(a ->> 'until') filter (where nullif(a ->> 'until', '') is not null)
      into v_roles, v_until
      from jsonb_array_elements(u.data -> 'roleIds') a
      join public.app_docs r on r.path = 'roledefs/' || (a ->> 'id')
     where nullif(a ->> 'until', '') is null or (a ->> 'until')::date >= v_today;

    select coalesce(bool_or(coalesce((x -> 'apps' ->> 'bv')::boolean, true)
                            and (jsonb_array_length(coalesce(x -> 'jobRoles', '[]')) > 0
                                 or coalesce((x -> 'apps' ->> 'mnt')::boolean, false) or coalesce((x -> 'apps' ->> 're')::boolean, false)
                                 or coalesce((x -> 'apps' ->> 'bnv')::boolean, false) or coalesce((x -> 'apps' ->> 'chm')::boolean, false))), false),
           jsonb_build_object(
             'mnt', coalesce(bool_or(coalesce((x -> 'apps' ->> 'mnt')::boolean, false)), false),
             're',  coalesce(bool_or(coalesce((x -> 'apps' ->> 're')::boolean, false)), false),
             'bnv', coalesce(bool_or(coalesce((x -> 'apps' ->> 'bnv')::boolean, false)), false),
             'chm', coalesce(bool_or(coalesce((x -> 'apps' ->> 'chm')::boolean, false)), false),
             'wb',  coalesce(bool_or(coalesce((x -> 'apps' ->> 'wb')::boolean, false)), false)),
           coalesce(bool_or(coalesce((x ->> 'reCompanies')::boolean, false)), false)
      into v_bv, v_div, v_reco
      from unnest(v_roles) x;

    select coalesce(jsonb_agg(j order by array_position(v_jobs, j)), '[]') into v_jr
      from (select distinct jsonb_array_elements_text(coalesce(x -> 'jobRoles', '[]')) j from unnest(v_roles) x) s
     where j = any(v_jobs);
    if v_jr ? 'approver' then
      select coalesce(jsonb_agg(k order by array_position(v_apof, k)), '[]') into v_ao
        from (select distinct jsonb_array_elements_text(coalesce(x -> 'apprOf', '[]')) k from unnest(v_roles) x) s
       where k = any(v_apof);
    else v_ao := 'null'; end if;
    select coalesce(jsonb_agg(c order by c), '[]') into v_cos
      from (select distinct jsonb_array_elements_text(coalesce(x -> 'companyIds', '[]')) c from unnest(v_roles) x) s;
    select coalesce(jsonb_object_agg(c, st), '{}') into v_map from (
      select c, jsonb_agg(stp order by array_position(v_steps, stp)) st
        from (select distinct e.key c, jsonb_array_elements_text(e.value) stp
                from unnest(v_roles) x, jsonb_each(coalesce(x -> 'roles', '{}')) e
               where jsonb_typeof(e.value) = 'array') s
       where v_cos ? c and stp = any(v_steps)
       group by c) t;

    v_apps := jsonb_build_object('bv', v_bv, 'acc', v_bv, 'fin', v_bv, 'apr', v_bv, 'pp', coalesce(u.data -> 'apps' -> 'pp', 'null')) || v_div;

    if coalesce(u.data -> 'apps', 'null') is distinct from v_apps
       or coalesce(u.data -> 'jobRoles', '[]') is distinct from v_jr
       or coalesce(u.data -> 'apprOf', 'null') is distinct from v_ao
       or coalesce((u.data ->> 'reCompanies')::boolean, false) is distinct from v_reco
       or coalesce(u.data -> 'roles', '{}') is distinct from v_map
       or coalesce(u.data ->> 'roleUntil', '') is distinct from coalesce(v_until, '')
       or not (coalesce(u.data -> 'companyIds', '[]') @> v_cos and v_cos @> coalesce(u.data -> 'companyIds', '[]'))
    then
      update public.app_docs set data = data || jsonb_build_object(
          'apps', v_apps, 'jobRoles', v_jr, 'apprOf', v_ao, 'reCompanies', v_reco, 'roles', v_map, 'roleUntil', to_jsonb(v_until),
          'companyIds', case when coalesce(data -> 'companyIds', '[]') @> v_cos and v_cos @> coalesce(data -> 'companyIds', '[]') then coalesce(data -> 'companyIds', '[]') else v_cos end,
          'updatedAt', (extract(epoch from now()) * 1000)::bigint, 'rolesBy', 'schedule')
       where path = u.path;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $function$;

revoke all on function private.apply_user_roles() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'apply-user-roles';
select cron.schedule('apply-user-roles', '2 * * * *', 'select private.apply_user_roles()');
