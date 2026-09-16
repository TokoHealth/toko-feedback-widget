-- Every feedback row becomes a Linear issue.
--
-- A cron job calls the feedback-to-linear Edge Function every five minutes.
-- The function claims unticketed rows through claim_feedback_for_linear,
-- creates one issue per row (using the row id as the issue id, so a retry
-- cannot duplicate it) and writes the issue key back.
-- Design: docs/feedback-to-linear/design.md
--
-- Applied by hand in the SQL editor, like the table migration. Safe to re-run.
--
-- The job reads two Vault secrets, set once by hand, never in git:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/feedback-to-linear', 'feedback_sync_url');
--   select vault.create_secret('<same value as FEEDBACK_SYNC_SECRET>', 'feedback_sync_secret');
-- Until both exist the job runs and does nothing.

alter table public.feedback_items
  add column if not exists linear_issue_id text,
  add column if not exists linear_issue_url text,
  add column if not exists linear_claimed_at timestamptz,
  add column if not exists linear_attempts int not null default 0,
  add column if not exists linear_last_error text;

create index if not exists feedback_items_unticketed_idx
  on public.feedback_items (created_at)
  where linear_issue_id is null;

-- `materialized` keeps the locking select from running more than once, which
-- could claim more than the cap.
create or replace function public.claim_feedback_for_linear(batch_size int)
returns setof public.feedback_items
language sql
as $$
  with c as materialized (
    select id from public.feedback_items
     where linear_issue_id is null
       and linear_attempts < 10
       and (linear_claimed_at is null or linear_claimed_at < now() - interval '10 minutes')
     order by created_at
     limit least(batch_size, 25)
     for update skip locked)
  update public.feedback_items f
     set linear_claimed_at = now(), linear_attempts = f.linear_attempts + 1
    from c
   where f.id = c.id
  returning f.*;
$$;

revoke all on function public.claim_feedback_for_linear(int) from public, anon, authenticated;
grant execute on function public.claim_feedback_for_linear(int) to service_role;

-- Ticketed by hand before this existed.
update public.feedback_items
   set linear_issue_id = 'TOK-676',
       linear_issue_url = 'https://linear.app/tokohealth/issue/TOK-676/forge-stage-michals-terrace-scene-with-other-people-instead-of-framed'
 where id = '5aad5810-91ff-47fe-aed8-1f4c3570f7a0'
   and linear_issue_id is null;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Scheduling by name replaces an existing job with that name.
-- pg_net's default 2-second timeout would drop the call mid-run.
select cron.schedule(
  'feedback-to-linear',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := u.decrypted_secret,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-feedback-sync-secret', s.decrypted_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000)
    from vault.decrypted_secrets u, vault.decrypted_secrets s
    where u.name = 'feedback_sync_url' and s.name = 'feedback_sync_secret';
  $job$
);
