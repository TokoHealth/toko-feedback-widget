-- The widget's backing schema.
--
-- This lived only in the Supabase dashboard until now -- it was created by
-- hand, so when the project went away there was nothing to replay. Hence this
-- file: the schema is a property of the WIDGET, so it belongs in the widget's
-- repo next to the code that reads and writes it.
--
-- Reconstructed from src/uploadFeedback.ts (the insert and the two selects)
-- and src/types.ts (FeedbackPin, FeedbackStatus).

create table if not exists public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Who and where from. `product` is the string each app passes to
  -- <FeedbackProvider>; it is what /review filters by.
  created_by_email text,
  product text not null,
  environment text not null default 'production',

  -- The page the feedback was left on. `url` is matched exactly by
  -- fetchPinsForPage, so the index below is on (product, url).
  url text not null,
  page_title text,

  -- The feedback itself.
  comment text not null,
  selected_text text,
  element_selector text,

  -- Paths into the feedback-attachments bucket, never public URLs: the widget
  -- resolves them through publicUrlFor() at render time.
  screenshot_path text,
  annotated_image_path text,

  -- metadata.position is what makes a row a PIN. fetchPinsForPage drops rows
  -- without it, so the default must be an object, not null.
  metadata jsonb not null default '{}'::jsonb,
  viewport jsonb,
  user_agent text,

  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'wont_fix'))
);

-- fetchPinsForPage filters product + url and orders by created_at.
create index if not exists feedback_items_product_url_idx
  on public.feedback_items (product, url, created_at);

alter table public.feedback_items enable row level security;

-- The widget ships a PUBLISHABLE key, so every visitor hits this table as
-- `anon`. That role gets exactly two things: append a row, and read the rows
-- back so pins render. Notably NOT update or delete -- triage happens in
-- /review under a real session, not from a browser holding a published key.
drop policy if exists "anon can submit feedback" on public.feedback_items;
create policy "anon can submit feedback"
  on public.feedback_items for insert to anon with check (true);

drop policy if exists "anon can read feedback" on public.feedback_items;
create policy "anon can read feedback"
  on public.feedback_items for select to anon using (true);

-- Public because publicUrlFor() hands the browser an unsigned URL. Anything
-- genuinely sensitive should not be in a screenshot in the first place.
insert into storage.buckets (id, name, public)
values ('feedback-attachments', 'feedback-attachments', true)
on conflict (id) do update set public = true;

drop policy if exists "anon can upload attachments" on storage.objects;
create policy "anon can upload attachments"
  on storage.objects for insert to anon
  with check (bucket_id = 'feedback-attachments');

drop policy if exists "anon can read attachments" on storage.objects;
create policy "anon can read attachments"
  on storage.objects for select to anon
  using (bucket_id = 'feedback-attachments');
