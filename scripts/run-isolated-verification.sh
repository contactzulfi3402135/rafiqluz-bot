#!/usr/bin/env bash
# Test harness for an independently copied, disposable source tree only.
# WARNING: several PG scripts drop explicitly named experimental schemas.
set -u
if [ "${RAQ_VERIFY_ALLOW:-}" != '1' ] || [ -z "${RAQ_VERIFY_OUTPUT:-}" ]; then
  echo 'Refusing: set RAQ_VERIFY_ALLOW=1 and RAQ_VERIFY_OUTPUT to a new private output directory.' >&2; exit 2
fi
case "$RAQ_VERIFY_OUTPUT" in /*) ;; *) echo 'Output directory must be absolute.' >&2; exit 2;; esac
if [ -e "$RAQ_VERIFY_OUTPUT" ] || [ -L "$RAQ_VERIFY_OUTPUT" ]; then echo 'Output directory already exists; refusing to overwrite.' >&2; exit 2; fi
if [ "${RAQ_TEST_PG_ALLOW_DROP:-}" != '1' ] || [[ ! "${RAQ_TEST_PG_DATABASE:-}" =~ ^raq_test_[a-z0-9_]+$ ]] || [[ ! "${RAQ_TEST_PG_RUNTIME:-}" =~ ^raq_test_[a-z0-9_]+$ ]] || [[ ! "${RAQ_TEST_PG_TENANT:-}" =~ ^raq_test_[a-z0-9_]+$ ]] || [[ "${RAQ_TEST_PG_HOST:-}" != /* ]] || [ -z "${RAQ_TEST_PG_ADMIN:-}" ] || [ -z "${RAQ_TEST_PG_PORT:-}" ]; then
 echo 'Refusing: explicitly disposable raq_test_* PostgreSQL database/roles, local Unix socket and RAQ_TEST_PG_ALLOW_DROP=1 are required. Never use a shared or production database.' >&2; exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd -P) || exit 2
for state in .env data sessions media uploads backups logs; do
 if [ -e "$root/$state" ] || [ -L "$root/$state" ]; then echo "Refusing: source tree contains $state; use a clean, state-free copy." >&2; exit 2; fi
done
parent=$(cd "$(dirname "$RAQ_VERIFY_OUTPUT")" && pwd -P) || exit 2
case "$parent/" in "$root/"*) echo 'Output must be outside the source tree.' >&2; exit 2;; esac
umask 077
mkdir "$RAQ_VERIFY_OUTPUT" || exit 2
mkdir "$RAQ_VERIFY_OUTPUT/state" || exit 2
export RAQ_STATE_DIR="$RAQ_VERIFY_OUTPUT/state"
# Empty values prevent dotenv from loading live provider credentials in tests.
export PERSIST_GITHUB_REPO='' PERSIST_GITHUB_TOKEN='' PERSIST_GITHUB_BRANCH=''
export OPENROUTER_API_KEY='' GEMINI_API_KEY='' TELEGRAM_BOT_TOKEN='' RAQ_SECRETS_KEY=''
export PADDLE_API_KEY='' PADDLE_WEBHOOK_SECRET='' PUBLIC_URL='' ENABLE_TUNNEL=''
export DASHBOARD_USERNAME='synthetic-admin' DASHBOARD_PASSWORD='synthetic-verification-password' SESSION_SECRET='synthetic-verification-session-secret-not-production'
cd "$root" || exit 2
failed=0
run() {
  local name="$1"; shift
  echo "Running $name"
  "$@" >"$RAQ_VERIFY_OUTPUT/$name.log" 2>&1
  local code=$?
  printf '%s exit=%s\n' "$name" "$code" >>"$RAQ_VERIFY_OUTPUT/status.txt"
  if [ "$code" -ne 0 ]; then failed=1; fi
}
node --version >"$RAQ_VERIFY_OUTPUT/node-version.txt" 2>&1
run app-suite npm test
run password-limit npm run test:saas-password-limits
run worker-runner npm run test:worker-runner
run postgres-control npm run test:pg-control
run postgres-worker npm run test:pg-worker
run postgres-paddle npm run test:pg-paddle
run postgres-sqlite-transfer npm run test:pg-sqlite-transfer
run postgres-http npm run test:pg-saas-http
run postgres-invitations npm run test:pg-invitations
run postgres-objects npm run test:pg-objects
run postgres-tenant-worker npm run test:pg-tenant-worker
run postgres-atomic-tenant-worker npm run test:pg-atomic-tenant-worker
printf '\nResults are synthetic; this does not verify live providers, browser UX, production tenancy, deployment, backup/restore, or release archive contents.\n' >>"$RAQ_VERIFY_OUTPUT/status.txt"
cat "$RAQ_VERIFY_OUTPUT/status.txt"
exit "$failed"
