# bb worktree setup. Runs once as `bash .bb-env-setup.sh` with cwd set to the
# new worktree, under a sanitized environment (no NODE_ENV, no BB_* vars).
# Steps are deliberately non-fatal: a failed install should still leave an
# openable workspace rather than destroying the worktree.
set -uo pipefail

log() { printf 'bb-setup: %s\n' "$*"; }

log "installing node dependencies"
npm ci || { log "npm ci failed, retrying with npm install"; npm install; } || log "WARNING: node install failed; run it by hand"

log "done"
