-- Masters › Others › Bank Names: the two cheque templates typed "HDFC" and "Axis" take the banks' RBI names, which are
-- added to the list with their IFSC codes.
insert into public.app_docs (path, data, updated_at)
select v.path, jsonb_build_object('name', v.name, 'code', v.code, 'active', true, 'createdAt', (extract(epoch from now()) * 1000)::bigint), now()
from (values ('banknames/bn_hdfc', 'HDFC Bank', 'HDFC'), ('banknames/bn_utib', 'Axis Bank', 'UTIB')) as v(path, name, code)
on conflict (path) do nothing;

update public.app_docs set data = jsonb_set(data, '{bank}', '"HDFC Bank"'), updated_at = now()
where path like 'chqtpl/%' and lower(trim(data->>'bank')) = 'hdfc';
update public.app_docs set data = jsonb_set(data, '{bank}', '"Axis Bank"'), updated_at = now()
where path like 'chqtpl/%' and lower(trim(data->>'bank')) = 'axis';
