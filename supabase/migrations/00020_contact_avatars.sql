-- Somewhere to keep the picture of a lead.
--
-- The platforms hand back a signed CDN link for a profile picture, and Meta
-- documents that theirs expires in a few days. Storing that link in
-- contacts.avatar_url is why the Inbox would show faces this week and broken
-- squares the next, so the bytes are copied here once and the row points at
-- our own copy instead.
--
-- Only the service role writes: the pictures arrive on the webhook and on the
-- channel sync, never from a browser. That is also why there is no insert or
-- update policy below. The service role bypasses RLS, and adding a policy for
-- `authenticated` would hand every signed-in user a way to put files here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contact-avatars',
  'contact-avatars',
  true,
  1048576,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read, because an <img> in the Inbox fetches it with no session.
create policy "contact avatars are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'contact-avatars');

-- What a platform told us about the person, beside the picture: follower
-- count, whether they are verified, whether they follow the account. It lives
-- in the existing metadata column rather than new columns because the set
-- differs per platform and is read whole, never filtered on.
comment on column public.contacts.metadata is
  'Platform profile facts, e.g. {"instagram":{"followerCount":120,"isVerified":false,"isFollower":true,"fetchedAt":"..."}}. Written by the webhook and the channel sync.';
