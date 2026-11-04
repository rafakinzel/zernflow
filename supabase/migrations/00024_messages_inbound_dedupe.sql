-- Inbound messages are stored from the webhook, which Zernio can redeliver
-- (on a timeout, or a non-2xx from us). Without a key to collide on, a
-- redelivery would file the same message twice and every count drawn from
-- this table would drift.
--
-- Partial, because only inbound rows carry a platform id today: the flow
-- engine's own sends leave it null, and a plain unique index would let only
-- one of those exist.

create unique index if not exists idx_messages_platform_message_id
  on messages (platform_message_id)
  where platform_message_id is not null;

-- The inbox lists a thread oldest-first; inbound rows make that list bigger.
create index if not exists idx_messages_conversation_direction
  on messages (conversation_id, direction, created_at);
