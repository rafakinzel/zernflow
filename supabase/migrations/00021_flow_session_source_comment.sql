-- Which comment started this run.
--
-- The question worth answering about a post is not how many people liked it,
-- it is how many people it put into a flow. That join exists today only
-- through the commenter's platform id, matched back to a contact: it works
-- until someone comments from one account and messages from another, or
-- comments twice under two posts, and then a post gets credit for a lead it
-- did not bring. A number that is right most of the time is worse than no
-- number, because nobody knows which times.
--
-- comment_logs already records the post, so pointing a session at the comment
-- row makes post to lead one join with no guessing in it.
alter table public.flow_sessions
  add column if not exists source_comment_log_id uuid
    references public.comment_logs(id) on delete set null;

-- The reporting query goes the other way: given a post's comments, which runs
-- did they start.
create index if not exists flow_sessions_source_comment_log_id_idx
  on public.flow_sessions (source_comment_log_id)
  where source_comment_log_id is not null;
