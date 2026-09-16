#!/bin/sh
# Database tests for the feedback table. Needs a running local stack
# (`supabase start`). Resets the LOCAL database only.
set -eu
cd "$(dirname "$0")/.."

container="supabase_db_toko-feedback-widget"
psql() { docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

supabase db reset --local

# The hand-ticketed row exists in production before the migration runs, and
# the migration is re-run by hand, so re-apply it over that row.
psql -c "insert into public.feedback_items (id, product, url, comment)
         values ('5aad5810-91ff-47fe-aed8-1f4c3570f7a0', 'toko-forge', 'https://example.test/', 'hand-ticketed');"
psql < supabase/migrations/20260916000000_feedback_linear_sync.sql > /dev/null
echo "ok - migration re-runs cleanly"

# Two overlapping runs take different rows.
tmp=$(mktemp -d)
psql -c "insert into public.feedback_items (product, url, comment)
         select 'overlap', 'https://example.test/', 'o' || n from generate_series(1, 6) n;"
psql -c "begin; select id from public.claim_feedback_for_linear(3); select pg_sleep(3); commit;" \
  | grep -E '^[0-9a-f-]{36}$' | sort > "$tmp"/claim_a &
sleep 1
start=$(date +%s)
psql -c "select id from public.claim_feedback_for_linear(3);" | sort > "$tmp"/claim_b
waited=$(( $(date +%s) - start ))
wait
[ "$(wc -l < "$tmp"/claim_a)" -eq 3 ] && [ "$(wc -l < "$tmp"/claim_b)" -eq 3 ] \
  || { echo "not ok - each run should claim 3 rows"; exit 1; }
[ -z "$(comm -12 "$tmp"/claim_a "$tmp"/claim_b)" ] || { echo "not ok - overlapping runs claimed the same row"; exit 1; }
[ "$waited" -lt 2 ] || { echo "not ok - the second run waited for the first"; exit 1; }
echo "ok - overlapping runs claim different rows without waiting"
psql -c "delete from public.feedback_items where product = 'overlap';"

supabase test db --local
