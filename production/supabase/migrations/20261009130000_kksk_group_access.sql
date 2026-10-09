-- Applied to KKSK-Production (rutrnzxcjtvakllvzpkw) on 2026-10-09. Kept here as the record;
-- this folder is NOT linked to Supabase's GitHub integration (supabase/ at the repo root is KKSK Group).
-- KKSK Group is the only way in: people sign in there and are handed over by the kksk-handover function.

-- pp_orders shows Zoho order lines: make it follow the reader's own access rules, read-only.
alter view public.pp_orders set (security_invoker = true);
revoke insert, update, delete, truncate, references, trigger on public.pp_orders from anon, authenticated;
revoke select on public.pp_orders from anon;

-- Active Production Planning people read the order lines of their region (and those not yet placed).
create policy "pp users read order lines" on public.sales_order_lines for select to authenticated
  using (
    public.pp_is_active()
    and not coalesce(is_deleted, false)
    and (public.pp_me_region() is null
         or case place_of_manufacture when 'Erode' then 'E' when 'Ambur' then 'A' end is null
         or case place_of_manufacture when 'Erode' then 'E' when 'Ambur' then 'A' end = public.pp_me_region())
  );

-- Trigger and maintenance functions are never called directly.
revoke execute on function public.pp_audit_row(), public.pp_entries_guard(), public.pp_lots_before_insert(),
  public.pp_lots_before_update(), public.pp_users_guard(), public.rls_auto_enable() from public, anon, authenticated;
-- Access helpers are used by the rules for signed-in people only.
revoke execute on function public.pp_has_role(text[]), public.pp_can_see(text), public.pp_is_active(),
  public.pp_me_region(), public.pp_me_role() from public, anon;
grant execute on function public.pp_has_role(text[]), public.pp_can_see(text), public.pp_is_active(),
  public.pp_me_region(), public.pp_me_role() to authenticated;
-- No signing up here any more: pp_users rows come only from the KKSK Group hand-over.
revoke execute on function public.pp_register(text) from public, anon, authenticated;
