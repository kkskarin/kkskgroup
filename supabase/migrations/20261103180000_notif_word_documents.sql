-- Official Notifications: a notification published only as a web page is kept as a Word document (and its text as a
-- note) under hsn-docs/auto/ in the bill-files bucket. Allow Word documents next to PDFs, images, Excel and JSON.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
where id = 'bill-files';
