#!/usr/bin/env bash
# The ONLY supported way to point a local command at the PRODUCTION database.
#
#   CONFIRM_PROD_DB=<supabase project ref> ./scripts/with-prod-db.sh npx tsx scripts/<op>.ts
#   CONFIRM_PROD_DB=<supabase project ref> ./scripts/with-prod-db.sh npm run migrate
#
# Reads DATABASE_URL and DIRECT_URL from .env.prod.local (never auto-loaded by anything) and
# exports both, so the Prisma CLI, lib/db and every script resolve the same database. Shell
# variables win over .env.local in Next.js and dotenv, so the local dev values are overridden.
#
# CONFIRM_PROD_DB must equal the project ref; lib/prod-db-guard.ts checks the match and refuses
# otherwise. REDIS_URL is CLEARED: a production op run from a laptop does not enqueue jobs into
# the live queue (enqueue paths log "REDIS_URL not set"). Storage and Firebase stay as in
# .env.local (off). Use this for reviewed operations only.

set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.prod.local"
[ -f "$ENV_FILE" ] || { echo "🛑 $ENV_FILE not found." >&2; exit 1; }

if [ -z "${CONFIRM_PROD_DB:-}" ]; then
  echo "🛑 REFUSING: set CONFIRM_PROD_DB=<supabase project ref> to run against production." >&2
  exit 1
fi
if [ "$#" -eq 0 ]; then
  echo "usage: CONFIRM_PROD_DB=<ref> $0 <command…>" >&2
  exit 2
fi

read_var() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'
}
PROD_DATABASE_URL="$(read_var DATABASE_URL)"
PROD_DIRECT_URL="$(read_var DIRECT_URL)"
[ -n "$PROD_DATABASE_URL" ] && [ -n "$PROD_DIRECT_URL" ] || { echo "🛑 DATABASE_URL/DIRECT_URL missing in $ENV_FILE" >&2; exit 1; }

echo "⚠️  PRODUCTION database (CONFIRM_PROD_DB=$CONFIRM_PROD_DB). Queue disabled for this run." >&2
export DATABASE_URL="$PROD_DATABASE_URL" DIRECT_URL="$PROD_DIRECT_URL" REDIS_URL=""
# Production Clerk only on request: CONFIRM_PROD_CLERK=<frontend host> (lib/prod-clerk-guard.ts
# checks it matches). Otherwise the Clerk keys are cleared so nothing reaches production users.
if [ -n "${CONFIRM_PROD_CLERK:-}" ]; then
  export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$(read_var NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)" CLERK_SECRET_KEY="$(read_var CLERK_SECRET_KEY)"
  echo "⚠️  PRODUCTION Clerk (CONFIRM_PROD_CLERK=$CONFIRM_PROD_CLERK)." >&2
else
  export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="" CLERK_SECRET_KEY=""
fi
unset TEST_DATABASE_URL
exec "$@"
