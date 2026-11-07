-- UNBUILT 0008: Storage bucket for offer screenshots (design 17 P1-7)
-- Public read (screenshots are shown on public product pages). There are no insert/update/delete policies on
-- storage.objects for anon or authenticated: uploads happen only through POST /api/products/[id]/screenshots, which
-- checks ownership, type and size and writes with the service-role client to `<builderId>/<uuid>.<ext>`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
