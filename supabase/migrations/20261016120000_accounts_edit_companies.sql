-- KKSK Group: the Accounts team (people with the Accountant job) may add and edit companies, like people given
-- users/<uid>.reCompanies; a company they add is put on their own user record. Companies are never deleted except by
-- an admin (others deactivate at most; the app offers that only to admins).

create or replace function public.claim_created_company(p_company text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := private.my_uid();
  v_user jsonb;
  v_co jsonb;
  v_steps jsonb;
begin
  if auth.uid() is null or not private.is_member() then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_company is null or p_company !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'bad company id' using errcode = '22023';
  end if;
  select d.data into v_co from public.app_docs d where d.path = 'companies/' || p_company;
  if v_co is null or coalesce(v_co ->> 'createdBy', '') <> v_uid then
    raise exception 'only the person who added this company' using errcode = '42501';
  end if;
  select d.data into v_user from public.app_docs d where d.path = 'users/' || v_uid for update;
  if v_user is null or not (coalesce((v_user ->> 'reCompanies')::boolean, false)
      or (jsonb_typeof(v_user -> 'jobRoles') = 'array' and v_user -> 'jobRoles' ? 'accountant')) then
    raise exception 'not allowed to add companies' using errcode = '42501';
  end if;
  if coalesce(v_user -> 'companyIds', '[]'::jsonb) ? p_company then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select coalesce(jsonb_agg(distinct s), '[]'::jsonb) into v_steps
    from jsonb_each(case when jsonb_typeof(v_user -> 'roles') = 'object' then v_user -> 'roles' else '{}'::jsonb end) r,
         jsonb_array_elements_text(case when jsonb_typeof(r.value) = 'array' then r.value else '[]'::jsonb end) s
   where s not in ('appr', 'rec');
  update public.app_docs d
     set data = jsonb_set(jsonb_set(d.data, '{companyIds}', coalesce(d.data -> 'companyIds', '[]'::jsonb) || to_jsonb(p_company)),
                          '{roles}', case when jsonb_typeof(d.data -> 'roles') = 'object' then d.data -> 'roles' else '{}'::jsonb end || jsonb_build_object(p_company, v_steps))
                || jsonb_build_object('updatedAt', (extract(epoch from now()) * 1000)::bigint),
         updated_at = now()
   where d.path = 'users/' || v_uid;
  return jsonb_build_object('ok', true, 'steps', v_steps);
end $$;
revoke execute on function public.claim_created_company(text) from anon, public;
grant execute on function public.claim_created_company(text) to authenticated;

-- Only admins delete a company document.
drop policy if exists "members delete docs" on public.app_docs;
create policy "members delete docs" on public.app_docs for delete to authenticated
  using (private.can_write(path) and (path not like 'companies/%' or private.is_app_admin()));
