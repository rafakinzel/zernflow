-- The Central TB's cloud routines prepare comment-to-DM flows for Rafa to
-- review and switch on. They reach us through their own key (see
-- app/api/v1/central), never through a person's session.
--
-- `created_via` says where a flow came from, so the routines can ask about
-- the flows they made and nothing else, and so the builder can show Rafa
-- which drafts are waiting for her. It is set once at insert and nothing
-- reads it to decide behaviour: a flow made here runs exactly like one she
-- drew herself, once she publishes it.
alter table public.flows add column if not exists created_via text;

create index if not exists idx_flows_created_via
  on public.flows (workspace_id, created_via)
  where created_via is not null;

-- Lead magnets (PDF) the routines upload, linked from the DM. Public read,
-- because the link is opened by whoever got the message, with no session
-- behind it. There are no write policies on purpose: the only writer is the
-- server with the service key, after it has checked the routine's key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'iscas',
  'iscas',
  true,
  52428800,
  array['application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
