-- The official HSN / SAC list (Tally (Demo) › Masters › HSN / SAC) is kept as a JSON file under hsn-docs/ in the
-- bill-files bucket, too large for one app_docs record. Allow JSON in the bucket.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/json'
]
where id = 'bill-files';
