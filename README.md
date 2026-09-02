# toko-feedback-widget

Internal feedback widget for Toko products. Team members can select any text
on the page to suggest an edit, or draw on a screenshot (à la Claude's design
review UI) to point at something and leave a note. Submissions are written to
a shared Supabase table (`public.feedback_items`, project **Toko Studio**) so
they all land in one review inbox regardless of which product they came from.

Supports RTL/Hebrew out of the box (`locale="he"`).

## Install

This is a private package, installed straight from GitHub (no registry setup
needed):

```bash
npm install github:TokoHealth/toko-feedback-widget
npm install @supabase/supabase-js html-to-image
```

## Usage

```tsx
import { createClient } from "@supabase/supabase-js";
import { FeedbackProvider } from "toko-feedback-widget";
import "toko-feedback-widget/style.css";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function RootLayout({ children }) {
  return (
    <FeedbackProvider
      supabaseClient={supabase}
      product="toko-app" // whatever you want to filter by in /review
      environment="production" // or "staging" / "local" — defaults to "production"
      locale="he" // or "en"
      createdByEmail={currentUser?.email}
    >
      {children}
    </FeedbackProvider>
  );
}
```

Env vars (same project for every consumer, so feedback aggregates centrally):

```
NEXT_PUBLIC_SUPABASE_URL=https://lysgohidbhsvowzctsqx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_oDMnGHD5EC43qqGc1_X7dw_6Xq7UlUv
```

That's it — a "Feedback" launcher button appears, text selection shows a
"Suggest edit" bubble, and submitted feedback leaves a numbered pin on the
page that anyone loading that same URL will see.

## Reviewing feedback

The review dashboard lives in the separate `toko-feedback` repo (`/review`
route) — point it at the same Supabase project and it lists everything
submitted from every product that has this widget installed.

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
