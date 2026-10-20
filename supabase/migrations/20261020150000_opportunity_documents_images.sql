-- The AI reads photos, screenshots and scanned pages of the expediente (workspace-scans.ts): the private documents bucket
-- also takes the image formats Claude reads. Only the server writes to it; its policies do not change.
update storage.buckets b
set allowed_mime_types = b.allowed_mime_types || array(
  select mime from unnest(array['image/png','image/jpeg','image/webp','image/gif']) as mime
  where not mime = any(coalesce(b.allowed_mime_types, array[]::text[])))
where b.id = 'opportunity-documents';
