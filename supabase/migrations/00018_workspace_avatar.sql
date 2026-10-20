-- A workspace can carry a picture of its own.
--
-- Until now the little image beside the workspace name was generated from the
-- name itself, so every workspace got a robot it never chose. The column holds
-- the public URL of an uploaded file rather than the bytes: images are served
-- straight from storage, and keeping them out of the row means a query for a
-- workspace does not drag an image along with it.
alter table public.workspaces add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-avatars',
  'workspace-avatars',
  true,
  2097152,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read, because the image is rendered by an <img> tag with no session
-- behind it. Writes are restricted to members of the workspace whose id names
-- the folder, so a member of one workspace cannot overwrite another's picture.
create policy "workspace avatars are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'workspace-avatars');

create policy "members upload their workspace avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-avatars'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

create policy "members replace their workspace avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'workspace-avatars'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

create policy "members remove their workspace avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'workspace-avatars'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id::text = (storage.foldername(name))[1]
    )
  );
