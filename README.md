# toko-feedback-widget

Internal feedback widget for Toko products. Team members can select any text
on the page to suggest an edit, or draw on a screenshot (à la Claude's design
review UI) to point at something and leave a note. Submissions are written to
a shared Supabase table (`public.feedback_items`, project **Toko Internal**) so
they all land in one review inbox regardless of which product they came from.

Supports RTL/Hebrew out of the box (`locale="he"`).

## Install

Private package, installed straight from GitHub — no registry setup:

```bash
npm install github:TokoHealth/toko-feedback-widget
```

That is the whole install. `@supabase/supabase-js` and `html-to-image` come
with it, and there is nothing to configure: the widget carries its own
connection to the shared feedback project.

> **Private repo, public builds.** A private GitHub dependency is cloned over
> SSH, so any CI or host that lacks a deploy key fails at `npm install` with
> `git@github.com: Permission denied (publickey)`. Vercel does. Either make
> this repo public (the only credential in it is a publishable key that is
> served to browsers anyway) or give the host a read-only token.

## Usage

> **Next.js App Router:** the component that renders `<FeedbackProvider>` needs
> `"use client"` — it uses hooks.

```tsx
"use client";

import { FeedbackProvider } from "toko-feedback-widget";
import "toko-feedback-widget/style.css";

export function Feedback({ children, email }) {
  return (
    <FeedbackProvider
      product="toko-app"        // what you filter by in /review
      createdByEmail={email}    // whoever is signed in
      locale="he"               // or "en"
    >
      {children}
    </FeedbackProvider>
  );
}
```

`environment` defaults to Vercel's `VERCEL_ENV` (production / preview /
development) and falls back to `"production"`.

### Pointing it somewhere else

`supabaseClient` is optional and defaults to the widget's own client. Pass one
only to override it — a test double, or a fork aimed at a different project:

```tsx
<FeedbackProvider supabaseClient={myClient} product="toko-app">{children}</FeedbackProvider>
```

Do **not** reuse your app's own `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` for this. Those point at your product's own
database, which has no `feedback_items` table — and repointing them to this
project signs every one of your users out.

That's it — a "Feedback" launcher button appears, text selection shows a
"Suggest edit" bubble, and submitted feedback leaves a numbered pin on the
page that anyone loading that same URL will see.

## The backing schema

`supabase/migrations/` holds the table, the `feedback-attachments` bucket and
their RLS policies. It is here rather than in the app repos because the schema
belongs to the widget: the code in `uploadFeedback.ts` is the only thing that
writes these columns.

Keep it that way. This table previously lived only in the Supabase dashboard,
created by hand -- so when its project was deleted there was no definition left
to replay, and the widget failed silently in every product at once.

`anon` gets insert and select, nothing more. Triage (`status` changes) happens
in /review under a real session, never from a browser holding the published key.

> **Applying it.** Toko Internal is shared with other internal tooling whose
> migration history lives elsewhere, so `supabase db push` from this repo will
> refuse to run. Apply this file through the dashboard SQL editor instead. It is
> idempotent, so re-running it is safe.

## Reviewing feedback

The review dashboard lives in the separate `toko-feedback` repo (`/review`
route) — point it at the same Supabase project and it lists everything
submitted from every product that has this widget installed.

## Linear issues

Every feedback row becomes a Linear issue in the Toko team within about five
minutes: a cron job calls the `feedback-to-linear` Edge Function, which writes
the issue key back to `linear_issue_id`. See
[the design](docs/feedback-to-linear/design.md). Tests: `npm run test:db` and
`npm run test:functions` (Linear is always faked).

## Why a shipped stylesheet instead of Tailwind classes your app compiles?

The components use Tailwind utility classes, but this package ships its own
compiled `dist/style.css` (utilities only, **no Preflight reset**) rather than
relying on your app's Tailwind build to pick up its classes. That way it
renders correctly regardless of whether the host app uses Tailwind, and it
never resets your app's own default element styles.

## Local development

```bash
npm install
npm run build      # tsup -> dist/index.js + dist/style.css
npm run typecheck
```
