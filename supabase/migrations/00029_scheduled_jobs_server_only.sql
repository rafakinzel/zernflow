-- scheduled_jobs is written and read only by the server (service role):
-- the cron runs the jobs, the flow engine schedules waits and rescues, and
-- the broadcast send route schedules deliveries with the service client after
-- checking the caller's workspace membership.
--
-- 00009 let ANY signed-in user read, create and change every job of every
-- workspace (auth.uid() IS NOT NULL). A forged resume_flow or send_broadcast
-- job would then run with full rights. RLS stays on, with no policy for
-- signed-in users, so only the service role (which bypasses RLS) reaches it.
--
-- Run this AFTER the code that schedules broadcasts with the service client is
-- deployed; before it, sending a broadcast from the dashboard would fail.

DROP POLICY IF EXISTS "Authenticated users can insert jobs" ON scheduled_jobs;
DROP POLICY IF EXISTS "Authenticated users can read jobs" ON scheduled_jobs;
DROP POLICY IF EXISTS "Authenticated users can update jobs" ON scheduled_jobs;

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
