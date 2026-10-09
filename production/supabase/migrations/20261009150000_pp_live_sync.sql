-- Applied to KKSK-Production through the Supabase connector as "pp_live_sync" (this project is not linked to GitHub).
-- Production Planning Live mode (kkskgroup.netlify.app/production/).
-- The page keeps its own working copy of each lot, entry and approval; key fields go into the proper
-- columns (rules, reports, triggers), and the rest of the page's record is kept in `extra`.
alter table public.pp_lots add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.pp_entries add column if not exists client_id text;
alter table public.pp_entries add column if not exists extra jsonb not null default '{}'::jsonb;
create unique index if not exists pp_entries_client_id_key on public.pp_entries (is_demo, client_id);
alter table public.pp_approvals add column if not exists client_id text;
alter table public.pp_approvals add column if not exists extra jsonb not null default '{}'::jsonb;
create unique index if not exists pp_approvals_client_id_key on public.pp_approvals (is_demo, client_id);

-- Orders show the customer too (same view as before plus customer_name; still security_invoker, read-only).
create or replace view public.pp_orders with (security_invoker = true) as
 SELECT uid, zoho_record_id, TRIM(BOTH FROM pi_number) AS pi_number, pi_date, TRIM(BOTH FROM po_number) AS po_number, po_date,
    due_date, brand, factory, type_of_sales, type_of_order, TRIM(BOTH FROM msku) AS msku, TRIM(BOTH FROM sku) AS sku,
    TRIM(BOTH FROM article_substance) AS article_substance, colour, type_of_article, order_quantity_sqft AS order_qty,
    COALESCE(dispatch_quantity_sqft, (0)::numeric) AS zoho_dispatched_qty,
    CASE place_of_manufacture WHEN 'Erode'::text THEN 'E'::text WHEN 'Ambur'::text THEN 'A'::text ELSE NULL::text END AS region,
    place_of_manufacture, last_issue_target_date AS wb_deadline, last_crust_delivery_target_date AS crust_deadline,
    last_finished_leather_delivery_target_date AS fl_deadline, order_status, synced_at,
    customer_name
   FROM sales_order_lines s
  WHERE ((NOT COALESCE(is_deleted, false)) AND pp_is_active() AND ((pp_me_region() IS NULL) OR (
        CASE place_of_manufacture WHEN 'Erode'::text THEN 'E'::text WHEN 'Ambur'::text THEN 'A'::text ELSE NULL::text END = pp_me_region())));
revoke insert, update, delete, truncate, references, trigger on public.pp_orders from anon, authenticated;
revoke select on public.pp_orders from anon;

-- Pooling orders is done by admins from the page.
create policy "pp_order_pooling_admin" on public.pp_order_pooling for insert to authenticated
  with check (public.pp_has_role('super_admin', 'admin'));
-- (A second, identical read policy on pp_pool_runs was also created here; it is harmless and can be dropped later:
--  drop policy "pp_pool_runs_read_admin_write_check" on public.pp_pool_runs;)
create policy "pp_pool_runs_read_admin_write_check" on public.pp_pool_runs for select to authenticated using (public.pp_is_active());

-- Screens refresh when someone else saves.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pp_lots, public.pp_entries, public.pp_approvals, public.pp_stock_moves,
      public.pp_pool_moves, public.pp_order_pooling, public.pp_yield_defaults, public.pp_wf1_other, public.sales_order_lines;
  end if;
end $$;
