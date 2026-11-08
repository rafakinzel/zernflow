-- Two-step login enforced by the database itself (Rafa, 08/11/2026).
--
-- The app sends a person who enrolled an authenticator to the code step
-- (middleware + lib/auth-policy.ts). But the browser holds the public anon key,
-- so a session that only proved the password (aal1) could still query
-- PostgREST directly. This makes every table refuse such a session.
--
-- A RESTRICTIVE policy is ANDed with the existing ones: it never grants
-- anything, it only adds the condition. People with no verified factor are
-- unaffected (aal1 or aal2 both pass), so turning this on locks nobody out.
-- The service role bypasses RLS, so webhooks, cron and the Central door are
-- untouched. Tables created later need the same policy (see CLAUDE.md).

create or replace function public.session_meets_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

revoke all on function public.session_meets_mfa() from public;
grant execute on function public.session_meets_mfa() to authenticated;

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "Require authenticator code when enrolled" on public.%I', t.relname);
    execute format(
      'create policy "Require authenticator code when enrolled" on public.%I as restrictive for all to authenticated using (public.session_meets_mfa()) with check (public.session_meets_mfa())',
      t.relname
    );
  end loop;
end $$;
