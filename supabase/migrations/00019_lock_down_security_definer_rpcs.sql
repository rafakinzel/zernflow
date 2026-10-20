-- Take the SECURITY DEFINER helpers off the public API.
--
-- These run as their owner, so they bypass row level security by design.
-- PostgREST exposes every function in `public` as an RPC endpoint, and the
-- default EXECUTE grant to PUBLIC meant an unauthenticated request could call
-- the mutating ones directly: guess a conversation id and you could write the
-- preview text and bump the unread count on a row RLS would never have let you
-- touch. Only the engine calls these, and it uses the service role.
revoke execute on function public.increment_unread(uuid, text) from public, anon, authenticated;
revoke execute on function public.increment_broadcast_sent(uuid) from public, anon, authenticated;
revoke execute on function public.increment_broadcast_failed(uuid) from public, anon, authenticated;

-- A trigger function has no business being callable over HTTP at all.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- This one is read-only and is called from inside RLS policies, so the
-- authenticated role must keep it or every policy that uses it stops working
-- (32 of them do). Only the blanket PUBLIC grant goes, which is what let anon
-- reach it.
revoke execute on function public.is_workspace_member(uuid) from public, anon;
