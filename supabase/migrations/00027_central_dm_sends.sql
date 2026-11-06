-- Direct-message replies the Central TB sends (Marina drafts them in
-- Thiago's voice, Rafa or Thiago approve them in the Central, and the
-- routine sends the approved text through app/api/v1/central/responder).
--
-- One row per send, written before the message goes out. It is three things
-- at once:
--  - the mark that a message in a thread came from the Central and not from
--    someone typing in the inbox or the Instagram app, because the inbox
--    keeps no local copy of what it sends and Zernio has no field for it;
--  - the idempotency record: a second send with the same `chave` inside 24
--    hours is refused, so a routine that retries after a timeout does not
--    answer the same person twice;
--  - the audit trail of what the Central said to whom, and when.
--
-- Nothing else reads it to decide behaviour, and nothing about the contact
-- is copied here: the conversation id is the only link.
create table if not exists public.central_dm_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  chave text,
  texto text not null,
  status text not null default 'enviando'
    check (status in ('enviando', 'enviado', 'falhou')),
  platform_message_id text,
  erro text,
  created_at timestamptz not null default now(),
  enviado_em timestamptz
);

-- Null keys never collide (a send without `chave` is never deduplicated).
create unique index if not exists idx_central_dm_sends_chave
  on public.central_dm_sends (workspace_id, chave);

create index if not exists idx_central_dm_sends_conversation
  on public.central_dm_sends (conversation_id, created_at desc);

-- Only the server writes or reads this, with the service key, after it has
-- checked the routine's key. RLS on with no policies keeps every session out.
alter table public.central_dm_sends enable row level security;
