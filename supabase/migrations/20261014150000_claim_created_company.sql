-- KKSK Group: someone allowed to add Renewable Energy companies (users/<uid>.reCompanies) gets a company they add put on their own
-- user record, with the steps they already hold on their other companies (never approving). People can't write their own user
-- record, so this runs as the owner, and only for a company that names the caller as its creator.
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
  if v_user is null or not coalesce((v_user ->> 'reCompanies')::boolean, false) then
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
