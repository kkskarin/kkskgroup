-- GST ledgers are a fixed set of nine, without rates: CGST, SGST and IGST Input, Input (RCM) and Input - Ineligible.
-- Replaces the per-rate GST ledgers started earlier today (nothing had been posted to them). TDS is unchanged.
delete from public.app_docs where path like 'taxes/gst\_%' escape '\' or path like 'ledgers/tax\_gst\_%' escape '\';
with now_ms as (select (extract(epoch from now()) * 1000)::bigint as t),
g(id, name, ord) as (values
  ('gst_cgst_in', 'CGST Input', 1), ('gst_sgst_in', 'SGST Input', 2), ('gst_igst_in', 'IGST Input', 3),
  ('gst_cgst_rcm', 'CGST Input (RCM)', 4), ('gst_sgst_rcm', 'SGST Input (RCM)', 5), ('gst_igst_rcm', 'IGST Input (RCM)', 6),
  ('gst_cgst_inel', 'CGST Input - Ineligible', 7), ('gst_sgst_inel', 'SGST Input - Ineligible', 8), ('gst_igst_inel', 'IGST Input - Ineligible', 9)
)
insert into public.app_docs (path, data, updated_at)
select 'taxes/' || id, jsonb_build_object('kind', 'gst', 'name', name, 'order', ord, 'active', true, 'createdAt', (select t from now_ms), 'updatedAt', (select t from now_ms)), now() from g
union all
select 'ledgers/tax_' || id, jsonb_build_object('main', 'Duties & Taxes', 'sub', 'GST', 'name', name, 'tax', 'gst', 'taxId', id, 'locked', true, 'allCos', true,
       'companyIds', '[]'::jsonb, 'apps', '["mnt","re","bnv"]'::jsonb, 'active', true, 'createdAt', (select t from now_ms), 'updatedAt', (select t from now_ms)), now() from g
on conflict (path) do nothing;
