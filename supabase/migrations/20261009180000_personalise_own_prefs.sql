-- Personalise is shared by every KKSK app and saved per login in prefs/<uid>.
-- Everyone signed in may read and write their own record, including people who use only Production Planning
-- (they are not Bills & Vouchers members, so the member policies don't cover them).
create policy "own prefs read" on public.app_docs for select to authenticated
  using (path = 'prefs/' || (select private.my_uid()));
create policy "own prefs insert" on public.app_docs for insert to authenticated
  with check (path = 'prefs/' || (select private.my_uid()));
create policy "own prefs update" on public.app_docs for update to authenticated
  using (path = 'prefs/' || (select private.my_uid())) with check (path = 'prefs/' || (select private.my_uid()));
