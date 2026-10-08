-- Demo and Live. Everything entered so far is demo data: it moves under the demo__ prefix, which only
-- admins switch to. Live keeps the plain paths and starts with the set-up only (companies, locations,
-- departments and ledgers, same ids, so people's company access still matches).
-- People, admins and access requests are shared by both.
update public.app_docs
   set path = 'demo__' || path
 where split_part(path, '/', 1) not in ('users', 'admins', 'requests')
   and path not like 'demo\_\_%';

insert into public.app_docs (path, data, updated_at, updated_by)
select substr(path, 7), data, now(), updated_by
  from public.app_docs
 where split_part(path, '/', 1) in ('demo__companies', 'demo__locations', 'demo__departments', 'demo__ledgers')
on conflict (path) do nothing;
