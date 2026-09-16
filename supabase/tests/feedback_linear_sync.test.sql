-- Run through scripts/test-db.sh, which re-applies the migration over the
-- hand-ticketed row first.
begin;
select plan(13);

-- The hand-ticketed row existed before the migration re-ran (AC-2).
select is(
  (select linear_issue_id from public.feedback_items where id = '5aad5810-91ff-47fe-aed8-1f4c3570f7a0'),
  'TOK-676', 'the hand-ticketed row is marked TOK-676');

-- Start from a table holding only the rows made here.
delete from public.feedback_items;

insert into public.feedback_items (product, url, comment, created_at)
select 'test', 'https://example.test/', 'row ' || n, now() - make_interval(mins => 100 - n)
from generate_series(1, 30) n;

-- AC-7, INV-5: 25 oldest first, then the remaining 5.
select is(
  (select array_agg(comment order by created_at) from public.claim_feedback_for_linear(100)),
  (select array_agg('row ' || n order by n) from generate_series(1, 25) n),
  'first run claims the 25 oldest rows, even when asked for more');
select is((select count(*)::int from public.claim_feedback_for_linear(25)), 5, 'next run claims the other 5');
select is((select count(*)::int from public.feedback_items where linear_attempts = 1), 30, 'each claim counts one attempt');

-- A claim holds for 10 minutes.
select is((select count(*)::int from public.claim_feedback_for_linear(25)), 0, 'claimed rows are not claimed again within 10 minutes');
update public.feedback_items set linear_claimed_at = now() - interval '11 minutes' where comment in ('row 1', 'row 2');
select is((select count(*)::int from public.claim_feedback_for_linear(25)), 2, 'a claim older than 10 minutes can be taken again');

-- Ticketed rows are never claimed.
update public.feedback_items set linear_claimed_at = null;
update public.feedback_items set linear_issue_id = 'TOK-1' where comment <> 'row 3';
select is((select comment from public.claim_feedback_for_linear(25)), 'row 3', 'only the unticketed row is claimed');

-- AC-8, INV-6: 10 attempts and the row is left alone, keeping its error.
update public.feedback_items
   set linear_claimed_at = null, linear_attempts = 10, linear_last_error = 'boom'
 where comment = 'row 3';
select is((select count(*)::int from public.claim_feedback_for_linear(25)), 0, 'a row with 10 attempts is not claimed');
select is((select linear_last_error from public.feedback_items where comment = 'row 3'), 'boom', 'it keeps its last error');

-- AC-6, INV-3: anon cannot claim or write ticket columns.
set local role anon;
select throws_ok('select public.claim_feedback_for_linear(1)', '42501', null, 'anon cannot run the claim function');
update public.feedback_items set linear_issue_id = 'HACKED';
reset role;
select is((select count(*)::int from public.feedback_items where linear_issue_id = 'HACKED'), 0, 'an anon update changes no row');

select ok(has_function_privilege('service_role', 'public.claim_feedback_for_linear(int)', 'execute'), 'service_role can run the claim function');

-- The job exists and waits long enough for a full run.
select ok(
  (select command like '%timeout_milliseconds := 300000%' from cron.job where jobname = 'feedback-to-linear' and schedule = '*/5 * * * *'),
  'the job runs every 5 minutes with a 300-second timeout');

select * from finish();
rollback;
