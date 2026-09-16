// Creates a Linear issue for each unticketed feedback row.
// Called every five minutes by the `feedback-to-linear` cron job.
// Design: docs/feedback-to-linear/design.md

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildIssueInput, type FeedbackRow, rowMarker, truncate } from "./issue.ts";

const BATCH = 25;
const ERROR_MAX = 500;
const LINEAR_URL = "https://api.linear.app/graphql";

// A stalled Linear call must not hold the whole batch. Edge Functions stop
// after 400 seconds, so a run stops starting rows after 240 and releases the rest.
export type Limits = { requestTimeoutMs: number; runBudgetMs: number };
const LIMITS: Limits = { requestTimeoutMs: 10_000, runBudgetMs: 240_000 };

export type Env = {
  syncSecret?: string;
  linearApiKey?: string;
  linearTeamId?: string;
  supabaseUrl: string;
};

// The database calls the handler makes. Every write leaves a ticketed row alone.
export type Db = {
  claim(batch: number): Promise<FeedbackRow[]>;
  saveIssue(id: string, key: string, url: string): Promise<void>;
  saveError(id: string, error: string): Promise<void>;
  // Undo a claim without using up an attempt.
  release(row: FeedbackRow): Promise<void>;
};

type Issue = { identifier: string; url: string };
type CreateResult =
  | { kind: "created"; issue: Issue }
  | { kind: "rate_limited" }
  | { kind: "failed"; error: string };

class RateLimited extends Error {}

async function linear(fetchFn: typeof fetch, key: string, timeoutMs: number, query: string, variables: unknown) {
  const res = await fetchFn(LINEAR_URL, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  const errors: { message?: string; extensions?: { code?: string; userPresentableMessage?: string } }[] = body.errors ??
    [];
  if (res.status === 429 || errors.some((e) => e.extensions?.code === "RATELIMITED")) {
    throw new RateLimited();
  }
  return { status: res.status, data: body.data, errors };
}

async function createIssue(
  fetchFn: typeof fetch,
  key: string,
  timeoutMs: number,
  input: ReturnType<typeof buildIssueInput>,
): Promise<CreateResult> {
  try {
    const created = await linear(
      fetchFn,
      key,
      timeoutMs,
      "mutation($i: IssueCreateInput!) { issueCreate(input: $i) { success issue { identifier url } } }",
      { i: input },
    );
    const issue = created.data?.issueCreate?.issue;
    if (issue) return { kind: "created", issue };

    // The row id is the issue id, so "already exists" usually means an earlier
    // run created it and crashed before writing it back. Record that issue, but
    // only if it is ours: a row id can be chosen to match an unrelated issue.
    const duplicate = created.errors.some((e) =>
      /already exists/i.test(e.extensions?.userPresentableMessage ?? e.message ?? "")
    );
    if (duplicate) {
      const found = await linear(fetchFn, key, timeoutMs, "query($id: String!) { issue(id: $id) { identifier url description } }", {
        id: input.id,
      });
      const existing = found.data?.issue;
      if (existing?.description?.includes(rowMarker(input.id))) {
        return { kind: "created", issue: { identifier: existing.identifier, url: existing.url } };
      }
      if (existing) return { kind: "failed", error: "Linear already has an unrelated issue with this row's id" };
    }
    const messages = created.errors.map((e) => e.extensions?.userPresentableMessage ?? e.message).join("; ");
    return { kind: "failed", error: `Linear ${created.status}: ${messages || "no issue returned"}` };
  } catch (e) {
    if (e instanceof RateLimited) return { kind: "rate_limited" };
    return { kind: "failed", error: String(e) };
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function createHandler(env: Env, db: Db, fetchFn: typeof fetch = fetch, limits: Limits = LIMITS) {
  return async (req: Request): Promise<Response> => {
    if (!env.syncSecret) return json(500, { error: "FEEDBACK_SYNC_SECRET is not set" });
    if (!sameSecret(req.headers.get("x-feedback-sync-secret") ?? "", env.syncSecret)) {
      return json(401, { error: "unauthorized" });
    }
    if (!env.linearApiKey || !env.linearTeamId) {
      return json(500, { error: "LINEAR_API_KEY and LINEAR_TEAM_ID must be set" });
    }
    const key = env.linearApiKey;
    const clean = (error: string) => truncate(error.replaceAll(key, "[redacted]"), ERROR_MAX);

    const started = Date.now();
    const rows = await db.claim(BATCH);
    let created = 0;
    let failed = 0;
    let i = 0;
    try {
      for (; i < rows.length; i++) {
        const row = rows[i];
        if (Date.now() - started > limits.runBudgetMs) {
          for (const rest of rows.slice(i)) await db.release(rest);
          console.warn(`Run budget spent: released ${rows.length - i} rows`);
          break;
        }
        const input = buildIssueInput(row, { teamId: env.linearTeamId, supabaseUrl: env.supabaseUrl });
        const result = await createIssue(fetchFn, key, limits.requestTimeoutMs, input);
        if (result.kind === "rate_limited") {
          // Leave the rest for the next run without costing them an attempt.
          for (const rest of rows.slice(i)) await db.release(rest);
          console.warn(`Linear rate limit: released ${rows.length - i} rows`);
          break;
        }
        if (result.kind === "created") {
          await db.saveIssue(row.id, result.issue.identifier, result.issue.url);
          created++;
        } else {
          const error = clean(result.error);
          console.error(`feedback ${row.id}: ${error}`);
          await db.saveError(row.id, error);
          failed++;
        }
      }
    } catch (e) {
      // A database write failed. Give the untried rows back their attempt.
      for (const rest of rows.slice(i)) await db.release(rest).catch(() => {});
      throw e;
    }
    return json(200, { claimed: rows.length, created, failed });
  };
}

export function supabaseDb(client: SupabaseClient): Db {
  const table = () => client.from("feedback_items");
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };
  return {
    async claim(batch) {
      const { data, error } = await client.rpc("claim_feedback_for_linear", { batch_size: batch });
      if (error) throw error;
      return data as FeedbackRow[];
    },
    async saveIssue(id, key, url) {
      check(
        await table()
          .update({ linear_issue_id: key, linear_issue_url: url, linear_claimed_at: null, linear_last_error: null })
          .eq("id", id)
          .is("linear_issue_id", null),
      );
    },
    async saveError(id, error) {
      check(
        await table()
          .update({ linear_last_error: error, linear_claimed_at: null })
          .eq("id", id)
          .is("linear_issue_id", null),
      );
    },
    async release(row) {
      check(
        await table()
          .update({ linear_claimed_at: null, linear_attempts: row.linear_attempts - 1 })
          .eq("id", row.id)
          .eq("linear_attempts", row.linear_attempts)
          .is("linear_issue_id", null),
      );
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const client = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  Deno.serve(createHandler({
    syncSecret: Deno.env.get("FEEDBACK_SYNC_SECRET"),
    linearApiKey: Deno.env.get("LINEAR_API_KEY"),
    linearTeamId: Deno.env.get("LINEAR_TEAM_ID"),
    supabaseUrl,
  }, supabaseDb(client)));
}
