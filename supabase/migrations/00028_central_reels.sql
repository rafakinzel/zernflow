-- Finished Reels the Central routine renders. Metricool only schedules an
-- Instagram Reel from a public video link, so the routine puts the approved
-- MP4 here and hands Metricool the public URL; once the Reel is out, the
-- routine deletes it. Public read for that reason. No write policies on
-- purpose: the only writer is the server with the service key, after it has
-- checked the routine's key (same as the `iscas` bucket in 00026).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reels',
  'reels',
  true,
  52428800,
  array['video/mp4']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
