# Turn widget feedback into Linear issues

> **Status:** Proposed for review

## 1. Executive summary

Feedback sent through the widget lands in `public.feedback_items` in the Toko Internal Supabase project and stays there. Nobody is told, the review dashboard is not deployed, and the only way to act on it today is to open the table by hand. Feedback gets lost.

After this change, every new feedback row becomes a Linear issue in the Toko team within about five minutes, and the row records which issue it became. A scheduled job calls a new Edge Function, `feedback-to-linear`, every five minutes. The function picks up rows that have no issue yet, creates one issue per row, and writes the issue key back. It uses the feedback row's own id as the Linear issue id, so a retry after a crash cannot create a second issue.

The main downside is that anyone holding the widget's public key can insert rows, and every row, from every environment, now becomes a Linear issue. A flood of junk rows becomes a flood of junk issues, bounded only by a per-run cap.

## 2. Context and scope

Today the widget inserts a row with the publishable key (`src/uploadFeedback.ts`) and nothing else happens. On 2026-09-16 the one existing row (`5aad5810-91ff-47fe-aed8-1f4c3570f7a0`) was copied into Linear by hand as TOK-676.

This design covers: new columns that record the Linear issue for each row, a claim function in Postgres, the Edge Function, the five-minute schedule, and marking the existing row as already ticketed. It covers feedback from every environment (`production`, `preview`, `development`), as decided on 2026-09-16.

It does not cover syncing anything back from Linear, such as closing a row when its issue closes.

## 3. System context

```
browser (widget, anon key)
   | insert
   v
public.feedback_items  <---- claim / write back ----+
   ^                                                 |
   | every 5 min: pg_cron -> pg_net HTTP POST        |
   |                         |                       |
   |                         v                       |
   |              Edge Function feedback-to-linear --+
   |                         |
   |                         v
   |                 Linear GraphQL API (Toko team)
   |
feedback-attachments bucket (public URLs used as images in the issue)
```

Toko Internal is shared with other internal tools whose migration history lives elsewhere, so this repo's SQL is applied through the dashboard SQL editor, as the README already says. Edge Functions deploy separately with `supabase functions deploy`, which does not touch migration history. The boundary the widget relies on stays as it is: `anon` gets insert and select only, with no update, and no new function it can execute.

## 4. Proposed design

### How it works

At 09:08 an animator selects a scene prompt in Toko Forge and writes "the setting should be with more people". The widget inserts a row, as it does today. The new columns are all empty.

At 09:10 pg_cron fires. It uses pg_net to POST to `/functions/v1/feedback-to-linear` with the header `x-feedback-sync-secret`, whose value comes from Supabase Vault, and `timeout_milliseconds := 300000`. pg_net's default 2-second timeout would drop the call partway through a run. The function checks the header, then calls the Postgres function `claim_feedback_for_linear(25)` with the service role key. That call stamps `linear_claimed_at = now()` on up to 25 unticketed rows, oldest first, adds one to `linear_attempts`, and returns them.

For each row the function builds an issue: the title is the first 80 characters of the comment, prefixed with the product (`[toko-forge] the setting should be with more people`). The description quotes the comment, the selected text, the reporter's email, the environment, and the page. Screenshots appear as images using their public bucket URLs. The page URL is also attached as a link. The function calls Linear's `issueCreate` with `id` set to the row's id, then writes the returned `identifier` and `url` into `linear_issue_id` and `linear_issue_url` and clears `linear_claimed_at` and `linear_last_error`.

The animator sees nothing new in the widget. The team sees `TOK-7xx` in the Toko backlog, and the row now shows which issue it became.

### Components and responsibilities

**Migration `supabase/migrations/20260916000000_feedback_linear_sync.sql`** owns the new columns, the partial index on unticketed rows, `claim_feedback_for_linear`, its grants, the cron job, and marking the existing row as TOK-676. It does not create the Vault secret or the function secrets, which are set once by hand because their values must not be in git.

**Postgres function `claim_feedback_for_linear(batch_size int)`** owns choosing which rows to process and making sure two runs that overlap never take the same row. It selects with `for update skip locked` and returns claimed rows. It does not call Linear. Only `service_role` can execute it.

**Edge Function `supabase/functions/feedback-to-linear/`** owns checking the secret, calling the claim function, turning a row into a Linear issue, calling Linear, and writing the result back. It is split into `issue.ts` (a pure function from row to Linear input, with no I/O) and `index.ts` (the handler, which receives `fetch` and the Supabase client from outside so tests can replace them). It does not decide which rows are due; that belongs to the claim function.

**pg_cron job `feedback-to-linear`** owns timing: one call every five minutes, with a 300-second HTTP timeout. It does not retry by itself; the next run is the retry.

### Decisions

**A five-minute schedule, not a database trigger.** A trigger on insert would create issues within seconds, but pg_net is fire-and-forget, so failed calls still need a scheduled sweep. That would make two ways issues get created. One scheduled sweep is the only path, and it also retries failures. The cost is a delay of up to five minutes, which was accepted on 2026-09-16.

**The feedback row's id is the Linear issue id.** Linear's `IssueCreateInput` takes an optional UUID `id`. If the function creates the issue and then crashes before writing it back, the next run sends the same id. Linear rejects it as a duplicate, and the function reads the existing issue with `issue(id)` and records it. This removes the only real way to get duplicate issues. The rejected alternative was searching Linear for the row id before creating, which costs an extra request on every retry and relies on search indexing. The cost is depending on this Linear behavior, which AC-4 proves against the real API before the rest is built. Rows have v4 UUIDs from `gen_random_uuid()`.

**A shared secret header, not the service role key, to call the function.** The function is deployed with `verify_jwt = false` and compares `x-feedback-sync-secret` to its `FEEDBACK_SYNC_SECRET` secret in constant time. Putting the service role key in Vault for pg_net would work too, but it would leave a key with full database access sitting in a second place. A leaked sync secret only lets someone start a sweep early.

**A claim with a 10-minute lease.** A row that is claimed but not written back becomes claimable again 10 minutes after `linear_claimed_at`. Ten minutes is longer than a whole run can take (Edge Functions are stopped after at most 400 seconds of wall-clock time), so a slow run never has its rows taken over by the next one. With the idempotent id, taking over a row by mistake would still not create a duplicate.

## 5. Invariants and requirements

### Invariants

- `INV-1`: A feedback row is linked to at most one Linear issue, and each Linear issue created by the sync belongs to exactly one row.
- `INV-2`: Once `linear_issue_id` is set, the sync never changes it.
- `INV-3`: `anon` cannot execute `claim_feedback_for_linear` or update any `linear_*` column.
- `INV-4`: The function does nothing and returns 401 unless the request carries the correct `x-feedback-sync-secret`.
- `INV-5`: One run claims at most 25 rows.
- `INV-6`: A row with `linear_attempts >= 10` is never claimed again.

### Requirements

- Every row with no issue, from any environment, gets one within 10 minutes of being inserted while Linear and Supabase are healthy (one five-minute schedule plus run time).
- The existing row `5aad5810-91ff-47fe-aed8-1f4c3570f7a0` is marked as `TOK-676` and never gets a second issue.
- Issues go to the Toko team in the team's default state, with no priority, labels, assignee, or project.
- Failures are written to `linear_last_error` on the row and to the function log. The error is truncated to 500 characters and never contains the Linear key.

## 6. Interfaces and data

New columns on `public.feedback_items`, all nullable except the counter:

- `linear_issue_id text`, the issue key such as `TOK-676`.
- `linear_issue_url text`.
- `linear_claimed_at timestamptz`, set while a run holds the row.
- `linear_attempts int not null default 0`.
- `linear_last_error text`.

Columns are added with `add column if not exists`. The TOK-676 backfill runs `where id = '5aad5810-...' and linear_issue_id is null`. The job is created with `cron.schedule('feedback-to-linear', ...)`, which replaces a job of the same name, so the migration needs no unschedule step and can be re-run.

A partial index `on (created_at) where linear_issue_id is null` keeps the claim query fast as the table grows. `anon` can still select every column, so these fields are readable through the widget's key. That is acceptable because they hold issue keys and short error text, and the Linear workspace itself stays private.

Claim function:

```sql
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
```

Write back after success, guarded so it cannot overwrite (INV-2):

```sql
update feedback_items
   set linear_issue_id = $key, linear_issue_url = $url,
       linear_claimed_at = null, linear_last_error = null
 where id = $id and linear_issue_id is null;
```

After a failure the function sets `linear_last_error` and clears `linear_claimed_at`, so the next run, five minutes later, retries the row.

Function secrets, set with `supabase secrets set` and never committed: `LINEAR_API_KEY`, `LINEAR_TEAM_ID` (`f22b9dae-976e-40ef-82a0-97e93231a2a3`), and `FEEDBACK_SYNC_SECRET`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the Edge runtime. The Vault secret `feedback_sync_secret` holds the same value as `FEEDBACK_SYNC_SECRET`, so the cron job can send it.

Response body, used by logs and tests: `{ "claimed": n, "created": n, "failed": n }`.

### Naming and identity

The Linear issue UUID is the feedback row's `id`, so it exists before the request is sent and never changes. `linear_issue_id` stores the key Linear returns (`TOK-676`). If the issue later moves to another team its key changes and the stored key goes stale, but the issue UUID still equals the row id, so it can always be found again. Stored URLs are only a convenience. The existing row was ticketed by hand with a different UUID, which is why the migration writes `TOK-676` to it directly rather than letting the sync find it.

## 7. Failure behavior and lifecycle

**Linear is down, rate-limited, or rejects the input.** The row gets `linear_last_error`, its claim is cleared, and the next run retries it. After 10 attempts the row is skipped for good (INV-6) and stays visible because `linear_issue_id is null and linear_attempts >= 10`. To retry it, set `linear_attempts = 0` in SQL. If Linear returns HTTP 429, the function stops processing the rest of this run's rows, releases their claims with `linear_claimed_at = null, linear_attempts = linear_attempts - 1 where id = any($unprocessed) and linear_issue_id is null` so a rate limit never uses up attempts, and waits for the next run.

**The function crashes after creating the issue but before writing it back.** The claim runs out after 10 minutes. The next run sends the same issue id, Linear rejects the duplicate, the function reads the existing issue and writes it back. No second issue is created (INV-1). If the id is rejected but `issue(id)` finds nothing (the issue was deleted first), the row records the error and stops after 10 attempts.

**The write back fails** (for example, Supabase is briefly unavailable). This is handled like a crash, as above.

**Runs overlap.** `skip locked` and the 10-minute claim keep them on different rows.

**Bad secret or missing secrets at startup.** A wrong header returns 401 and does nothing. If `LINEAR_API_KEY` or `LINEAR_TEAM_ID` is missing, the function returns 500 before claiming anything, so no attempts are used up.

**Enable and disable.** Deploying the migration schedules the job. `select cron.unschedule('feedback-to-linear')` stops it. Rows inserted while it is stopped are processed oldest first, 25 per run, once it is scheduled again. There is no other in-flight state to drain; an interrupted run behaves like a crash.

**Everything fails at once.** Rows pile up with no issue and a growing attempt count, and are capped at 10 attempts, which takes about 50 minutes. They stay recoverable by resetting the counter.

## 8. Security, privacy, and operations

The trust boundary is the function's secret header. Row content is untrusted input from anyone with the public key. It is only placed inside Markdown sent to Linear, and it is never executed, used as a GraphQL variable name, or put into SQL, which uses parameters. Comment and selected text are truncated to 10,000 characters each before being placed in the description.

Anyone with the public key can already insert rows. With this change each row also becomes a Linear issue, and development-environment rows are included by decision. The limit is 25 issues per five minutes, which is 300 per hour. A flood fills the Toko backlog at that rate and uses about 300 Linear requests per hour, which must stay under the API key's hourly limit (check the current limit during AC-4). Cleanup is by hand. This is accepted for now; see Open questions.

Reporter emails, page URLs, and screenshots are copied into Linear. The workspace is private to the team, and those screenshots are already public URLs in the bucket, so nothing becomes more exposed than it already is.

Cost: one Edge Function call every five minutes, about 8,600 a month, well within the Supabase plan.

## 9. Acceptance criteria

- `AC-1`: A row inserted with the anon key gets a Linear issue in the Toko team, with the product, comment, selected text, reporter, environment, page link and any screenshot images, and the row's `linear_issue_id` and `linear_issue_url` are set within 10 minutes.
- `AC-2`: After the migration and several runs, row `5aad5810-...` still shows `TOK-676` and Linear has no second issue for it.
- `AC-3`: Calling the function twice for the same unticketed row, including after a simulated crash between creating the issue and writing it back, produces one issue and one stored key.
- `AC-4`: Against the real Linear API, `issueCreate` with a supplied UUID succeeds once, a second call with the same UUID fails, and `issue(id)` returns the first issue. Also check what a reused id returns after the first issue is deleted, and note the API key's hourly rate limit. This is checked once by hand before the function is built on it.
- `AC-5`: A request without the correct secret gets 401 and claims no rows.
- `AC-6`: With the anon key, calling `claim_feedback_for_linear` fails with permission denied, and an update to `linear_issue_id` changes no row (read back, the value is unchanged).
- `AC-7`: With 30 unticketed rows, one run claims 25 and the next claims 5.
- `AC-8`: A row whose issue creation fails 10 times is no longer claimed and keeps its last error.
- `AC-9`: After deployment, one scheduled run triggered through pg_net tickets 25 waiting rows, with none left claimed.

## 10. Test approach

Function logic is tested with `deno test` in `supabase/functions/feedback-to-linear/`. A fake Linear `fetch` and a fake claim/write-back client are passed in, so no test calls Linear. These tests cover row-to-issue mapping, the secret check (INV-4, AC-5), duplicate-id recovery (INV-1, AC-3), stopping on 429, error truncation and stripping the key, and missing secrets.

SQL is tested against a local stack (`supabase start`, then the migration) with a script under `supabase/tests/` run by `supabase test db` (pgTAP). It covers the claim cap and order (INV-5, AC-7), `skip locked` under two sessions, the 10-minute claim, the attempt limit (INV-6, AC-8), the write-back guard (INV-2), the anon grants (INV-3, AC-6), and marking the existing row (AC-2).

AC-4 is a one-time manual check with a disposable issue, deleted afterwards. AC-9 is checked after deployment by inserting 25 test rows from a preview. AC-1 is checked end to end after deployment by submitting real feedback from a preview deploy and watching the issue appear. It stays an unchecked box in the PR until that is done.

## 11. Risks and tradeoffs

- Linear might ignore or reject a client-supplied `id`. AC-4 checks this first. If it fails, the fallback is to search for the row id in the description before retrying, and this design is updated.
- Spam issues, as described in section 8. The mitigation is the per-run cap. A stronger fix, such as captcha or authenticated inserts, is out of scope.
- Development feedback may clutter the backlog. The decision was to accept this. The environment is in the issue so it can be filtered.
- The migration is applied by hand in the SQL editor on a shared project, so it can drift from the repo. The migration is idempotent (`add column if not exists`, `create or replace`, a named `cron.schedule`, a guarded backfill) so re-running it is safe.

## 12. Open questions

- Which Linear account should create the issues? Recommended: an API key from a bot member of the workspace, so issues don't show as created by Alon. Not blocking; any key works, and it can be changed later by swapping the secret.
- Are the `pg_cron` and `pg_net` extensions already enabled on Toko Internal, and do the other internal tools there already use Vault? This must be checked before deploying (`select * from pg_extension`). Not blocking for building; blocking for deploying.
- Should issues get a `Feedback` label or go to Triage instead of Backlog? Recommended: add a `Feedback` label once one exists, through an optional `LINEAR_LABEL_ID` secret. Not blocking.
- Should there be a rate limit on how many rows `anon` can insert? Not blocking; see section 8.

## 13. Out of scope

- Syncing issue status back to `feedback_items.status`.
- Deploying the `toko-feedback` review dashboard.
- Mapping products to Linear projects, and setting assignees or priority.
- Changes to the widget package itself; it inserts rows exactly as before.
