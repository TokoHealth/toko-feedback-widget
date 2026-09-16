import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler, type Db, type Env, supabaseDb } from "./index.ts";
import { buildIssueInput, type FeedbackRow } from "./issue.ts";

const KEY = "lin_api_secret123";
const ENV: Env = { syncSecret: "s3cret", linearApiKey: KEY, linearTeamId: "team-1", supabaseUrl: "https://ref.supabase.co" };

function row(n: number, extra: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    product: "toko-forge",
    environment: "production",
    url: "https://forge.test/page",
    page_title: "Forge",
    comment: `comment ${n}`,
    selected_text: null,
    created_by_email: "a@toko.health",
    screenshot_path: null,
    annotated_image_path: null,
    linear_attempts: 1,
    ...extra,
  };
}

function fakeDb(rows: FeedbackRow[]) {
  const calls: string[] = [];
  const db: Db = {
    claim: () => {
      calls.push("claim");
      return Promise.resolve(rows);
    },
    saveIssue: (id, key) => {
      calls.push(`issue ${id} ${key}`);
      return Promise.resolve();
    },
    saveError: (id, error) => {
      calls.push(`error ${id} ${error}`);
      return Promise.resolve();
    },
    release: (r) => {
      calls.push(`release ${r.id}`);
      return Promise.resolve();
    },
  };
  return { db, calls };
}

type Reply = { status?: number; body: unknown };
// Answers Linear calls in order and records each request body.
function fakeLinear(replies: Reply[]) {
  const sent: { query: string; variables: Record<string, any> }[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected Linear call");
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetchFn, sent };
}

const ok = (n: number): Reply => ({
  body: { data: { issueCreate: { success: true, issue: { identifier: `TOK-${n}`, url: `https://linear.app/i/TOK-${n}` } } } },
});
const post = (secret = "s3cret") =>
  new Request("http://x/", { method: "POST", headers: { "x-feedback-sync-secret": secret } });

Deno.test("a wrong or missing secret returns 401 and claims nothing (AC-5)", async () => {
  for (const req of [post("nope"), new Request("http://x/", { method: "POST" })]) {
    const { db, calls } = fakeDb([row(1)]);
    const res = await createHandler(ENV, db, fakeLinear([]).fetchFn)(req);
    assertEquals(res.status, 401);
    assertEquals(calls, []);
  }
});

Deno.test("missing Linear settings return 500 before claiming", async () => {
  const { db, calls } = fakeDb([row(1)]);
  const res = await createHandler({ ...ENV, linearApiKey: undefined }, db)(post());
  assertEquals(res.status, 500);
  assertEquals(calls, []);
});

Deno.test("creates one issue per row, using the row id, and saves the key", async () => {
  const { db, calls } = fakeDb([row(1), row(2)]);
  const linear = fakeLinear([ok(1), ok(2)]);
  const res = await createHandler(ENV, db, linear.fetchFn)(post());
  assertEquals(await res.json(), { claimed: 2, created: 2, failed: 0 });
  assertEquals(linear.sent.map((s) => s.variables.i.id), [row(1).id, row(2).id]);
  assertEquals(linear.sent[0].variables.i.teamId, "team-1");
  assertEquals(calls, ["claim", `issue ${row(1).id} TOK-1`, `issue ${row(2).id} TOK-2`]);
});

Deno.test("a retry after a crash records the existing issue instead of a second one (AC-3)", async () => {
  const { db, calls } = fakeDb([row(1)]);
  const linear = fakeLinear([
    {
      status: 400,
      body: { data: null, errors: [{ message: "conflict on insert of Issue", extensions: { code: "INPUT_ERROR", userPresentableMessage: `Entity Issue with id ${row(1).id} already exists.` } }] },
    },
    { body: { data: { issue: { identifier: "TOK-9", url: "https://linear.app/i/TOK-9" } } } },
  ]);
  const res = await createHandler(ENV, db, linear.fetchFn)(post());
  assertEquals(await res.json(), { claimed: 1, created: 1, failed: 0 });
  assertEquals(linear.sent.length, 2);
  assertStringIncludes(linear.sent[1].query, "issue(id");
  assertEquals(calls, ["claim", `issue ${row(1).id} TOK-9`]);
});

Deno.test("a rate limit releases this and later rows without using an attempt", async () => {
  const { db, calls } = fakeDb([row(1), row(2), row(3)]);
  const linear = fakeLinear([ok(1), { status: 429, body: {} }]);
  const res = await createHandler(ENV, db, linear.fetchFn)(post());
  assertEquals(await res.json(), { claimed: 3, created: 1, failed: 0 });
  assertEquals(calls, ["claim", `issue ${row(1).id} TOK-1`, `release ${row(2).id}`, `release ${row(3).id}`]);
});

Deno.test("a GraphQL RATELIMITED error counts as a rate limit", async () => {
  const { db, calls } = fakeDb([row(1)]);
  const linear = fakeLinear([{ status: 400, body: { errors: [{ message: "limit", extensions: { code: "RATELIMITED" } }] } }]);
  await createHandler(ENV, db, linear.fetchFn)(post());
  assertEquals(calls, ["claim", `release ${row(1).id}`]);
});

Deno.test("a failure saves a short error without the key and moves on", async () => {
  const { db, calls } = fakeDb([row(1), row(2)]);
  const long = `bad ${KEY} ` + "x".repeat(2000);
  const linear = fakeLinear([{ status: 400, body: { errors: [{ message: long }] } }, ok(2)]);
  const res = await createHandler(ENV, db, linear.fetchFn)(post());
  assertEquals(await res.json(), { claimed: 2, created: 1, failed: 1 });
  const saved = calls[1];
  assert(saved.startsWith(`error ${row(1).id} Linear 400: bad [redacted]`));
  assert(!saved.includes(KEY));
  assertEquals(saved.length, `error ${row(1).id} `.length + 500);
  assertEquals(calls[2], `issue ${row(2).id} TOK-2`);
});

Deno.test("the issue carries product, comment, selection, reporter, environment, page and images (AC-1)", () => {
  const input = buildIssueInput(
    row(1, {
      comment: "the setting should be with more people\nand michal should interact",
      selected_text: "A covered stone terrace",
      environment: "preview",
      screenshot_path: "toko-forge/a b.png",
      annotated_image_path: "toko-forge/d.png",
    }),
    { teamId: "team-1", supabaseUrl: "https://ref.supabase.co" },
  );
  assertEquals(input.title, "[toko-forge] the setting should be with more people");
  for (const part of [
    "> the setting should be with more people\n> and michal should interact",
    "> A covered stone terrace",
    "**Reporter:** a@toko.health",
    "**Environment:** preview",
    "[Forge](<https://forge.test/page>)",
    "![Screenshot](<https://ref.supabase.co/storage/v1/object/public/feedback-attachments/toko-forge/a%20b.png>)",
    "![Drawing](<https://ref.supabase.co/storage/v1/object/public/feedback-attachments/toko-forge/d.png>)",
    row(1).id,
  ]) assertStringIncludes(input.description, part);
});

Deno.test("page title, URL and email cannot add links, images or lines", () => {
  const input = buildIssueInput(
    row(1, {
      page_title: "x](https://evil.test) ![i](https://evil.test/p.png)",
      url: "https://a.test/?q=%20ok>\n![i](https://evil.test)",
      created_by_email: "a@b.c\n\n![i](https://evil.test)",
    }),
    { teamId: "t", supabaseUrl: "u" },
  );
  const lines = input.description.split("\n").filter((l) => l.startsWith("**"));
  assertEquals(lines, [
    String.raw`**Reporter:** a@b.c \!\[i\]\(https://evil.test\)  `,
    "**Environment:** production  ",
    String.raw`**Page:** [x\]\(https://evil.test\) \!\[i\]\(https://evil.test/p.png\)](<https://a.test/?q=%20ok%3E%0A![i](https://evil.test)>)`,
  ]);
});

Deno.test("a backslash in the URL cannot end the link early", () => {
  const input = buildIssueInput(row(1, { url: String.raw`x![i](https://evil.test/p.png)\` }), { teamId: "t", supabaseUrl: "u" });
  assertStringIncludes(input.description, "(<x![i](https://evil.test/p.png)%5C>)");
});

Deno.test("a failed database write gives untried rows back their attempt", async () => {
  const { db, calls } = fakeDb([row(1), row(2), row(3)]);
  db.saveIssue = (id) => {
    calls.push(`issue ${id}`);
    return id === row(2).id ? Promise.reject(new Error("db down")) : Promise.resolve();
  };
  const linear = fakeLinear([ok(1), ok(2)]);
  let threw = false;
  await createHandler(ENV, db, linear.fetchFn)(post()).catch(() => (threw = true));
  assert(threw);
  assertEquals(calls, ["claim", `issue ${row(1).id}`, `issue ${row(2).id}`, `release ${row(2).id}`, `release ${row(3).id}`]);
});

Deno.test("long titles and texts are cut", () => {
  const input = buildIssueInput(row(1, { comment: "y".repeat(20_000) }), { teamId: "t", supabaseUrl: "u" });
  assertEquals(input.title.length, 80);
  assert(input.description.length < 10_200);
});

// Against the local stack (`supabase start`), with Linear still faked.
const LOCAL_URL = Deno.env.get("LOCAL_SUPABASE_URL");
const LOCAL_KEY = Deno.env.get("LOCAL_SERVICE_ROLE_KEY");
Deno.test({
  name: "local database: issue saved once, errors kept, rate limit returns the attempt (INV-2)",
  ignore: !LOCAL_URL || !LOCAL_KEY,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const client = createClient(LOCAL_URL!, LOCAL_KEY!, { auth: { persistSession: false } });
    const table = () => client.from("feedback_items");
    await table().delete().eq("product", "fn-test");
    const { data: inserted } = await table()
      .insert([1, 2, 3].map((n) => ({ product: "fn-test", url: "https://t/", comment: `c${n}`, created_at: new Date(Date.UTC(2000, 0, n)).toISOString() })))
      .select("id");
    assertEquals(inserted!.length, 3);
    const db = supabaseDb(client);

    const linear = fakeLinear([ok(1), { status: 400, body: { errors: [{ message: "nope" }] } }, { status: 429, body: {} }]);
    const res = await createHandler(ENV, db, linear.fetchFn)(post());
    assertEquals((await res.json()).created, 1);

    const { data } = await table()
      .select("comment, linear_issue_id, linear_claimed_at, linear_attempts, linear_last_error")
      .eq("product", "fn-test").order("comment");
    assertEquals(data, [
      { comment: "c1", linear_issue_id: "TOK-1", linear_claimed_at: null, linear_attempts: 1, linear_last_error: null },
      { comment: "c2", linear_issue_id: null, linear_claimed_at: null, linear_attempts: 1, linear_last_error: "Linear 400: nope" },
      { comment: "c3", linear_issue_id: null, linear_claimed_at: null, linear_attempts: 0, linear_last_error: null },
    ]);

    // A saved key is never overwritten.
    await db.saveIssue(inserted![0].id, "TOK-2", "https://x");
    const { data: after } = await table().select("linear_issue_id").eq("id", inserted![0].id).single();
    assertEquals(after!.linear_issue_id, "TOK-1");

    await table().delete().eq("product", "fn-test");
  },
});
