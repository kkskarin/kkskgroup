-- Demo: people an admin switched Demo on for (users/<id>.demoOk) practise the steps after their own, so they open apps their
-- live jobs don't give them. app_portal now also returns `demo`: the apps they may open while working in Demo. The page
-- lets them in only when their saved mode is Demo; their Live access (`apps`) is unchanged.
--   everyone given Demo: Approvals (approving what they raised, in an admin's name)
--   an Accountant: also Accounts and their divisions' apps (entering)
--   a Financier: also Accounts, Finance and their divisions' apps
create or replace function public.app_portal()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
  v_demo jsonb := null;
  v_jobs jsonb; v_fn boolean; v_ac boolean;
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
    if v_bv and coalesce((v_user ->> 'demoOk')::boolean, false) then
      v_jobs := coalesce(v_user -> 'jobRoles', '[]'::jsonb);
      v_fn := v_jobs ? 'financier'; v_ac := v_fn or v_jobs ? 'accountant';
      v_demo := jsonb_build_object('apr', true, 'acc', v_ac, 'fin', v_fn,
        'mnt', v_ac and coalesce((v_apps ->> 'mnt')::boolean, true),
        're', v_ac and coalesce((v_apps ->> 're')::boolean, false),
        'bnv', v_ac and coalesce((v_apps ->> 'bnv')::boolean, false));
    end if;
  else
    v_bv := false; v_mnt := false; v_re := false; v_bnv := false; v_acc := false; v_fin := false; v_apr := false; v_wb := false; v_pp := null;
  end if;
  return jsonb_build_object(
    'signedIn', true, 'uid', v_uid, 'email', private.jwt_email(),
    'name', coalesce(nullif(v_user ->> 'name', ''), v_name, ''),
    'super', v_super, 'admin', v_admin, 'approved', v_admin or v_user is not null,
    'apps', jsonb_build_object('bv', v_bv, 'mnt', v_mnt, 're', v_re, 'bnv', v_bnv, 'acc', v_acc, 'fin', v_fin, 'apr', v_apr, 'wb', v_wb, 'pp', v_pp),
    'demo', v_demo);
end $function$;
