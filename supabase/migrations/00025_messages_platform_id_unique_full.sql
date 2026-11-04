-- The index added in 00024 was partial (`where platform_message_id is not
-- null`), which Postgres will not accept as an `on conflict
-- (platform_message_id)` target: inferring a partial index requires the
-- statement to repeat the predicate, and PostgREST has no way to send one.
-- Every upsert failed with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" — in the backfill loudly, and in
-- the webhook quietly, into a log nobody reads.
--
-- The partial clause was guarding against nothing. A plain unique index
-- treats nulls as distinct, so the flow engine's own sends, which never set
-- a platform id, can all sit there as null without colliding.

drop index if exists idx_messages_platform_message_id;

create unique index if not exists idx_messages_platform_message_id
  on messages (platform_message_id);
