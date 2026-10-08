-- Demo and Live share the set-up: people, admins, access requests, companies, locations, departments
-- and ledgers. Only entries (bills, vouchers, proformas, reports, payments, cash advances, vendors made
-- from bills, balances and the change log) are kept apart. The demo copies of the set-up made by the
-- previous migration are no longer used.
delete from public.app_docs
 where split_part(path, '/', 1) in ('demo__companies', 'demo__locations', 'demo__departments', 'demo__ledgers');
