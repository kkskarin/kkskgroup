-- GST and TDS: the tax ledgers, the same in every company (Masters › Ledgers › GST and TDS).
-- Starts the lists with the TDS sections the app already offered and the current GST rates, and makes their ledgers
-- under Duties & Taxes, open to every company (allCos) and division. Shared by Demo and Live (taxes and ledgers are
-- not namespaced). Existing documents are left as they are.
with now_ms as (select (extract(epoch from now()) * 1000)::bigint as t),
tds(id, sec, nature, rate, rate2) as (values
  ('tds_194c', '194C', 'Contractors', 1::numeric, 2::numeric),
  ('tds_194j', '194J', 'Professional or technical fees', 10, null),
  ('tds_194h', '194H', 'Commission or brokerage', 2, null),
  ('tds_194ia', '194I(a)', 'Rent of plant or machinery', 2, null),
  ('tds_194ib', '194I(b)', 'Rent of land or building', 10, null),
  ('tds_194q', '194Q', 'Purchase of goods', 0.1, null),
  ('tds_194a', '194A', 'Interest', 10, null)
),
gst(id, rate, typ) as (values
  ('gst_in_5', 5::numeric, 'Input'), ('gst_in_18', 18, 'Input'), ('gst_in_40', 40, 'Input'),
  ('gst_rcm_5', 5, 'RCM'), ('gst_rcm_18', 18, 'RCM')
),
taxdocs as (
  select 'taxes/' || id as path, jsonb_build_object('kind', 'tds', 'sec', sec, 'nature', nature, 'rate', rate, 'rate2', rate2, 'active', true, 'createdAt', (select t from now_ms), 'updatedAt', (select t from now_ms)) as data from tds
  union all
  select 'taxes/' || id, jsonb_build_object('kind', 'gst', 'rate', rate, 'type', typ, 'active', true, 'createdAt', (select t from now_ms), 'updatedAt', (select t from now_ms)) from gst
),
leds as (
  select 'ledgers/tax_' || id as path, 'TDS' as sub, 'TDS Payable u/s ' || sec as name, 'tds' as kind, id from tds
  union all
  select 'ledgers/tax_' || id || '_' || part, 'GST',
         (case typ when 'RCM' then 'RCM ' else 'Input ' end) || upper(part) || (case typ when 'RCM' then ' Payable' else '' end)
           || ' @ ' || (select case when v = trunc(v) then trunc(v)::text else trim(trailing '0' from round(v, 3)::text) end from (select case part when 'igst' then rate else rate / 2 end as v) x) || '%',
         'gst', id
    from gst cross join (values ('cgst'), ('sgst'), ('igst')) p(part)
)
insert into public.app_docs (path, data, updated_at)
select path, data, now() from taxdocs
union all
select path, jsonb_build_object('main', 'Duties & Taxes', 'sub', sub, 'name', name, 'tax', kind, 'taxId', id, 'locked', true, 'allCos', true,
       'companyIds', '[]'::jsonb, 'apps', '["mnt","re","bnv"]'::jsonb, 'active', true, 'createdAt', (select t from now_ms), 'updatedAt', (select t from now_ms)), now()
  from leds
on conflict (path) do nothing;
