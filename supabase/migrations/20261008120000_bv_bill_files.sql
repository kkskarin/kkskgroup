-- Bill files are kept so the accountant can look at the bill while accounting it.
-- Private bucket; paths are <mode>/bills/<bill id>/<file name>, mode being live or demo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bill-files', 'bill-files', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members read bill files" on storage.objects for select to authenticated
  using (bucket_id = 'bill-files' and (select private.is_member()));
create policy "members add bill files" on storage.objects for insert to authenticated
  with check (bucket_id = 'bill-files' and (select private.is_member()));
-- A file goes with its bill: the person who added it, or an admin, may remove it.
create policy "owner or admin removes bill files" on storage.objects for delete to authenticated
  using (bucket_id = 'bill-files' and (owner_id = (select auth.uid())::text or (select private.is_app_admin())));
