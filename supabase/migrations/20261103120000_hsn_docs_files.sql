-- Official HSN documents (Tally (Demo) › Masters › HSN / SAC): the GST portal's HSN list is an Excel file,
-- kept with the bill files under hsn-docs/. Allow Excel in the bucket next to PDFs and images.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'
]
where id = 'bill-files';
