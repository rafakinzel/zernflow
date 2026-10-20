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
wrong branch without anybody noticing. Unmatched text hands the conversation to
a human unless the flow draws its own `reply` exit.

## Messaging window

Meta allows a message within 24 hours of the person's last action. Waits are
capped at 20h in the builder (`SAFE_WAIT_HOURS`) and the engine checks the
window again before sending (`messaging-window.ts`), recording a
`message_skipped_window` event rather than sending into a closed window.
