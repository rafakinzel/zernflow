# BorrelliChat

Self-hosted ManyChat replacement at bot.thiagoborrelli.com. Next.js App Router,
Supabase, React Flow canvas, Vitest.

## Writing to a live flow

A flow row is edited from two places: Rafa in the builder, and an agent in SQL.
The builder already refuses to save over a row that moved since it was opened
(`baseUpdatedAt` in `flow-canvas.tsx`, which raises the amber conflict banner).
SQL has no such protection, so an agent that reads a flow, thinks for ten
minutes and writes back will silently erase whatever was published in between.

Every write to `flows.nodes` or `flows.edges` outside the builder follows this,
with no exceptions for small changes:

1. Snapshot first: insert into `zf_flow_backups` (`flow_id`, `note`,
   `snapshot`), with the note saying what is about to change and why.
2. Read `updated_at` along with the graph.
3. Guard the write on it, and confirm the row count:

   ```sql
   update flows set edges = ..., updated_at = now()
   where id = '<flow>' and updated_at = '<the value read in step 2>'
   returning id;
   ```

   No row back means she saved or published in the meantime. Re-read, re-apply
   the change on top of her version, and never drop the guard to force it
   through. Her edit is the base; the agent's change goes on top of it.
4. Check integrity after: no edge pointing at a missing node, every button on a
   waiting node carrying an exit of its own, no waiting node left with no way
   out, no node nothing reaches.
5. Check `flow_sessions` for anyone parked on a node the change touches, and
   remap their `current_node_id` and any pending `scheduled_jobs` by hand.

Prefer computing the new graph inside the single SQL statement (jsonb
operations on the row being written) over reading it out, transforming it here
and writing it back: the read and the write are then one atomic statement and
cannot straddle somebody else's save.

The engine reads the live `flows` row, not a published snapshot, so a graph
edit takes effect on the next message with no publish needed. Publishing bumps
`version` and stores a snapshot for rollback; it is not what puts a change on
the air.

## Replies at a decision point

`lib/flow-engine/reply-matching.ts` decides what a typed reply means when a
node was waiting with buttons. It matches the words on the buttons literally
and refuses anything ambiguous, because a wrong match walks someone down the
wrong branch without anybody noticing.

On a step that offers a single button (a "shall we?"), a reply that only says
"go on" follows that button, courtesy included: "Olá Thiago! Obrigada pelo
retorno. Tá joia, pode perguntar!" is a yes (`ASSENT` and `ASSENT_COMPANY`).
Never widen this to steps with a real choice.

## A message typed in the middle of a flow (Rafa, 08/11/2026)

Nothing pauses on its own. A message the step cannot read as an answer leaves
the run exactly where it was, waiting for a tap or for its own deadline, and
is recorded as `typed_during_flow` for the Central to answer
(`GET /api/v1/central/perguntas-no-fluxo`). Typed during a timed Delay, same.
See `lib/flow-engine/typed-during-flow.ts`.

The one exception is a plain request to stop (`isStopRequest` in
`opt-out.ts`): the run ends at once. It is deliberately narrow: the whole
message, courtesy aside, must be a stop phrase, never a question, so "não sei
se é pra mim" or "não quero agora" never end a run.

Pausing is a person's decision: "Pause bot" in the inbox
(`POST /api/v1/conversations/:id/automation`). While paused the run stays on
its step and the cron holds its scheduled steps (`heldByPause`), keeping the
time they were due in `payload.dueAt`; "resume" brings them back to that time,
or to now if it passed. The lead sees none of it. A `humanTakeover` node drawn
in a flow still ends the run on purpose; those are listed, read-only, at
`GET /api/v1/central/fluxos-parados`. The Central door never resumes a run or
lifts a pause (see the guards in `lib/central-agent/*.test.ts`).

## The first message of a comment flow

It goes out as Instagram's private reply to the comment, and it carries the
node's buttons (`private-reply-options.ts`): up to 3 as buttons, quick replies
turned into postback buttons so a non-follower sees them in Message Requests.
If the platform refuses the version with buttons, the same text goes again
without them. Until 08/11/2026 it went as bare text and the drawn button never
reached anyone.

## The keyword always starts over

Rafa's rule (07/11/2026): whoever sends a flow's keyword, by comment, DM or
story reply, gets the flow from the start, as if for the first time, whether
the conversation was paused, a run was half-way or they got the same flow
months ago. A matched trigger retires every active run (`executeFlow`); a DM
keyword lifts a pause (`restartFromKeyword`); a commented keyword does too
(the conversation upsert in `comment-processor.ts`). Nothing limits a flow to
once per person; do not add such a limit.

## Calling someone by name

Rafa's rule (07/11/2026): `{{first_name}}` is only the name the person told us
in a flow that asks for it (the stored `first_name` field). The Instagram
profile name is never used: it was often missing, and the bot greeted people by
their @. Without a stored name the variable is blank and the line is tidied so
everybody gets the same message with no name ("Olá {{first_name}}!" → "Olá!",
"{{first_name}}, notei…" → "Notei…"). See `lib/flow-engine/contact-name.ts`.
Resumed runs re-read the stored name, so an old run's saved @ is not reused.

## Messaging window

Meta allows a message within 24 hours of the person's last action. Waits are
capped at 20h in the builder (`SAFE_WAIT_HOURS`) and the engine checks the
window again before sending (`messaging-window.ts`), recording a
`message_skipped_window` event rather than sending into a closed window.

## Reading from Zernio

Two things about this API have already cost real leads, and neither shows up
as an error.

Direction is `incoming` and `outgoing`, never `inbound`/`outbound`. A
comparison against our own vocabulary silently marks every message in every
thread as if the contact had written it. `lib/messaging/zernio-provider.ts`
translates; nothing else should compare raw direction values.

Threads are paginated, 100 a page, with `pagination.hasMore` and
`pagination.nextCursor`. `hasMore` is the stop signal: a cursor without it
means done. Reading one page looks fine until something counts.

The inbox reads threads live from Zernio. The local `messages` table exists
to count and classify across conversations, not to render one. Inbound rows
come from the webhook; a reply typed into the Instagram app reaches us only
through a backfill, never through the engine.

Zernio rate-limits. A rate limit says nothing about the record it lands on,
so a loop must stop and resume rather than mark it visited and move past it.

## Upserting into messages

`platform_message_id` carries a plain unique index, and the upsert target
depends on it staying plain: Postgres will not infer a partial index for
`on conflict (col)` unless the statement repeats the predicate, which
PostgREST cannot send. Nulls are distinct, so rows without a platform id do
not collide.

`messages` has a select policy and an insert policy and no update policy. An
upsert that updates on conflict is refused through a user session; the
backfill route settles authorisation on the caller's session first and then
writes with the service key.

## Telling a waiting lead from one who left

Who spoke last is the signal. The person spoke and nothing went out after:
pending. We spoke last and they did not come back: abandoned. A session
waiting with a job scheduled is neither. Both directions must be in the
table for this to mean anything, which is why the backfill brings back our
own replies and not only theirs.

## Security notes (review of 07/11/2026)

- `scheduled_jobs` is server-only (migration 00029): no policy for signed-in
  users. Anything that schedules a job uses the service client, after its own
  session and membership check (see the broadcast send route).
- Cron routes use `lib/cron-auth.ts` (constant-time) and take the secret only
  from `Authorization: Bearer <CRON_SECRET>`; `?key=` is refused. The caller
  is cron-job.org (jobs every minute, sequences every 5), moved to the header
  on 08/11/2026. If the cron ever starts failing with 401, check its header.
- The httpRequest block encodes lead-typed values (URL) and escapes them (JSON
  body), never calls internal hosts (`refuseHttpTarget`), and gives up after
  10 s. `HTTP_REQUEST_ALLOWED_HOSTS` narrows it to listed hosts when set.
- The Zernio webhook answers every refusal with the same 401, unknown account
  included, and runs the own-account loop checks only after the signature.
- Still open on purpose: members can read `workspaces.webhook_secret`. Hiding the
  column or limiting updates to the owner touches the settings, avatar and
  ActiveCampaign screens; do it with those tested.

## Logging in (08/11/2026)

- Two-step login with an authenticator app (TOTP, Supabase MFA). Enrolled in
  Settings > Security. Once a person has a verified factor, a password-only
  session (aal1) is sent to the code step on pages and gets 401 from the API
  (`lib/supabase/middleware.ts`, rule in `lib/auth-policy.ts`), and the
  database refuses it too: every RLS table carries the restrictive policy
  "Require authenticator code when enrolled" (migration 00030). A new table
  needs that policy as well.
- Sessions end 30 days after sign-in (`MAX_SESSION_DAYS`), dated by the
  session's own authentication timestamps.
- Locked out (lost the phone, no second authenticator): remove the factor in
  the Supabase dashboard, Authentication > Users > the user > MFA factors.

