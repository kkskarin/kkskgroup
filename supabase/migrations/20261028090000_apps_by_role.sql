-- Apps come with the role. Accounts: accounting or Chief Accountant. Finance: paying or Chief Accountant. Approvals:
-- approving or recording approvals. The Accounts / Finance / Approvals ticks no longer switch these off. The division ticks
-- (mnt, re, bnv; Maintenance & Civil on unless said otherwise) are the person's scope: a division app opens for entering
-- there (Renewable Energy also for Sales), and Accounts and Finance show only those divisions (enforced in the app).
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
  v_entry text[] := array['bills', 'bcr', 'adv', 'vouchers', 'vcr', 'cash'];
  v_mnt boolean; v_re boolean; v_bnv boolean; v_acc boolean; v_fin boolean; v_apr boolean; v_wb boolean;
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
    v_bv := true; v_mnt := true; v_re := true; v_bnv := true; v_acc := true; v_fin := true; v_apr := true; v_wb := true;
    v_pp := jsonb_build_object('role', case when v_super then 'super_admin' else 'admin' end, 'region', null);
  elsif v_user is not null then
    v_apps := coalesce(v_user -> 'apps', '{}'::jsonb);
    v_bv := coalesce((v_apps ->> 'bv')::boolean, true);
    v_mnt := v_bv and coalesce((v_apps ->> 'mnt')::boolean, true) and private.user_has_any_step(v_user, v_entry);
    v_re := v_bv and coalesce((v_apps ->> 're')::boolean, false) and private.user_has_any_step(v_user, v_entry || array['solar']);
    v_bnv := v_bv and coalesce((v_apps ->> 'bnv')::boolean, false) and private.user_has_any_step(v_user, v_entry);
    v_acc := v_bv and (private.user_has_any_step(v_user, array['acct']) or private.is_chief(v_user));
    v_fin := v_bv and (private.user_has_any_step(v_user, array['txn']) or private.is_chief(v_user));
    v_apr := v_bv and private.user_has_explicit_any(v_user, array['appr', 'rec']);
    v_wb := coalesce((v_apps ->> 'wb')::boolean, false);
    v_pp := case when coalesce(v_apps -> 'pp' ->> 'role', '') in ('approver', 'planner', 'floor')
                 then jsonb_build_object('role', v_apps -> 'pp' ->> 'role',
                                         'region', nullif(v_apps -> 'pp' ->> 'region', ''))
                 else null end;
  else
    v_bv := false; v_mnt := false; v_re := false; v_bnv := false; v_acc := false; v_fin := false; v_apr := false; v_wb := false; v_pp := null;
  end if;
  return jsonb_build_object(
    'signedIn', true, 'uid', v_uid, 'email', private.jwt_email(),
    'name', coalesce(nullif(v_user ->> 'name', ''), v_name, ''),
    'super', v_super, 'admin', v_admin, 'approved', v_admin or v_user is not null,
    'apps', jsonb_build_object('bv', v_bv, 'mnt', v_mnt, 're', v_re, 'bnv', v_bnv, 'acc', v_acc, 'fin', v_fin, 'apr', v_apr, 'wb', v_wb, 'pp', v_pp));
end $$;
revoke execute on function public.app_portal() from anon, public;
grant execute on function public.app_portal() to authenticated;
