-- KKSK Group: approving is a job of its own (Approver, step "appr"), no longer the financier's.
-- The Approvals app (apps.apr) is for admins and people given Approval for at least one company. Unlike the other
-- steps, Approval is never assumed for someone saved before responsibilities existed.

create or replace function private.user_has_explicit_step(p_user jsonb, p_step text) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_user -> 'roles') = 'object'
     and exists (select 1 from jsonb_each(p_user -> 'roles') r, jsonb_array_elements_text(case when jsonb_typeof(r.value) = 'array' then r.value else '[]'::jsonb end) s where s = p_step)
$$;
revoke execute on function private.user_has_explicit_step(jsonb, text) from anon, public;

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
  v_apps jsonb;
  v_mnt boolean; v_re boolean; v_acc boolean; v_fin boolean; v_apr boolean;
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
    v_bv := true; v_mnt := true; v_re := true; v_acc := true; v_fin := true; v_apr := true;
    v_pp := jsonb_build_object('role', case when v_super then 'super_admin' else 'admin' end, 'region', null);
  elsif v_user is not null then
    v_apps := coalesce(v_user -> 'apps', '{}'::jsonb);
    v_bv := coalesce((v_apps ->> 'bv')::boolean, true);
    v_mnt := v_bv and coalesce((v_apps ->> 'mnt')::boolean, true);
    v_re := v_bv and coalesce((v_apps ->> 're')::boolean, false);
    v_acc := v_bv and coalesce((v_apps ->> 'acc')::boolean, private.user_has_step(v_user, 'acct'));
    v_fin := v_bv and coalesce((v_apps ->> 'fin')::boolean, private.user_has_step(v_user, 'txn'));
    -- Approvals is for admins and approvers only.
    v_apr := v_bv and private.user_has_explicit_step(v_user, 'appr') and coalesce((v_apps ->> 'apr')::boolean, true);
    v_pp := case when coalesce(v_apps -> 'pp' ->> 'role', '') in ('approver', 'planner', 'floor')
                 then jsonb_build_object('role', v_apps -> 'pp' ->> 'role',
                                         'region', nullif(v_apps -> 'pp' ->> 'region', ''))
                 else null end;
  else
    v_bv := false; v_mnt := false; v_re := false; v_acc := false; v_fin := false; v_apr := false; v_pp := null;
  end if;
  return jsonb_build_object(
    'signedIn', true, 'uid', v_uid, 'email', private.jwt_email(),
    'name', coalesce(nullif(v_user ->> 'name', ''), v_name, ''),
    'super', v_super, 'admin', v_admin, 'approved', v_admin or v_user is not null,
    'apps', jsonb_build_object('bv', v_bv, 'mnt', v_mnt, 're', v_re, 'acc', v_acc, 'fin', v_fin, 'apr', v_apr, 'pp', v_pp));
end $$;
revoke execute on function public.app_portal() from anon, public;
grant execute on function public.app_portal() to authenticated;
