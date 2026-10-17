-- KKSK Group: someone given only W/B Costing (users/<uid>.apps.wb) is a member too, so the database rules let them read
-- and write; until now membership keyed off the money apps (apps.bv), so a W/B-Costing-only person saw an empty app.
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
                 and (coalesce((d.data -> 'apps' ->> 'bv')::boolean, true)
                      or coalesce((d.data -> 'apps' ->> 'wb')::boolean, false)))
  )
$$;
