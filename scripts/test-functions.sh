#!/bin/sh
# Edge Function tests. Linear is always faked. With a local stack running
# (`supabase start`), the database test runs too; otherwise it is skipped.
set -eu
cd "$(dirname "$0")/.."
if status=$(supabase status -o env 2>/dev/null); then
  export LOCAL_SUPABASE_URL="$(echo "$status" | sed -n 's/^API_URL="\(.*\)"/\1/p')"
  export LOCAL_SERVICE_ROLE_KEY="$(echo "$status" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p')"
fi
deno test --allow-env --allow-net supabase/functions/feedback-to-linear
