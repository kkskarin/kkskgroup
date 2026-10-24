-- Personal settings (prefs/<uid>: look, picture, WhatsApp number) are readable only by the person themselves and by
-- admins (who see a person's picture while viewing the app as them). Other members no longer read them.
drop policy if exists "members read docs" on public.app_docs;
create policy "members read docs" on public.app_docs for select to authenticated
  using ((select private.is_member())
         and (path not like 'prefs/%' or path = 'prefs/' || (select private.my_uid()) or (select private.is_app_admin())));
