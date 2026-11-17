#!/usr/bin/env bash
# ONE SOURCE for the test-database connection, for PRISMA CLI invocations.
#
# WHY THIS EXISTS — a real incident, 2026-07-25. `prisma/schema.prisma` declares BOTH
# `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`, and every `prisma migrate`
# / `db push` / `db execute` / `migrate diff` command connects through **directUrl**, not url.
#
# So `DATABASE_URL=<local> npx prisma migrate resolve …` looks correct, prints a banner naming
# the PRODUCTION host, and connects to production. That is what happened: three `migrate
# resolve` calls intended for a local container reached the live database. No DDL executed
# (resolve writes only the tracking row) but a spurious row landed in prod's
# `_prisma_migrations`. The margin was Prisma's semantics, not any structural barrier.
#
# The failure is two-copies-of-one-truth in the tooling layer: THREE variables must agree, and
# setting a subset fails silently and invisibly. This script is the single source — it sets all
# three from one value, so a partial environment cannot fall through to .env.local.
#
#   ./scripts/with-test-db.sh npx prisma migrate deploy
#   ./scripts/with-test-db.sh npx prisma migrate status
#   ./scripts/with-test-db.sh npx tsx scripts/verify-all.ts
#
# It REFUSES to run if the resolved URL is not local — belt and braces with lib/test-db.ts.

set -euo pipefail

TEST_DB="${TEST_DATABASE_URL_OVERRIDE:-postgresql://fairsynq:fairsynq@localhost:55432/fairsynq_test}"

host="$(printf '%s' "$TEST_DB" | sed -E 's#^[^:]+://([^@]*@)?([^:/]+).*#\2#')"
case "$host" in
  localhost|127.0.0.1|fairsynq-test-db) ;;
  *)
    echo "🛑 REFUSING: test DB host resolved to '$host', which is not local." >&2
    echo "   This wrapper exists to make a production connection impossible from tooling." >&2
    exit 1
    ;;
esac

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command…>   e.g. $0 npx prisma migrate deploy" >&2
  exit 2
fi

# THE TEST REDIS AND RATE LIMITER, pinned the same way (found Nov 16: gate suites load .env.local,
# and this wrapper used to pin only the database, so the rate limiter and the vendor auth cache
# used whatever Upstash .env.local named, and the order routes failed closed with 429 whenever it
# was not reachable). dotenv never overrides a variable that is already set, so these win.
#   • Upstash: the test stand-in (docker-compose.test.yml, fairsynq-test-upstash on 58080), with
#     the token read from that file (SRH_TOKEN) so there is one copy of it. Local hosts only.
#   • REDIS_URL: pinned EMPTY. The test Redis has no published port, and no gate suite needs the
#     job queue or the sweep heartbeat (both skip cleanly when it is empty).
TEST_UPSTASH="${TEST_UPSTASH_URL:-http://localhost:58080}"
upstash_host="$(printf '%s' "$TEST_UPSTASH" | sed -E 's#^[^:]+://([^@]*@)?([^:/]+).*#\2#')"
case "$upstash_host" in
  localhost|127.0.0.1) ;;
  *)
    echo "🛑 REFUSING: test Upstash host resolved to '$upstash_host', which is not local." >&2
    exit 1
    ;;
esac
COMPOSE_TEST_FILE="$(cd "$(dirname "$0")/.." && pwd)/docker-compose.test.yml"
TEST_UPSTASH_TOKEN="$(sed -nE 's/^[[:space:]]*SRH_TOKEN:[[:space:]]*//p' "$COMPOSE_TEST_FILE" 2>/dev/null | head -n 1 | tr -d "\"'\r" || true)"
if [ -z "$TEST_UPSTASH_TOKEN" ]; then
  echo "🛑 REFUSING: no SRH_TOKEN found in docker-compose.test.yml; cannot pin the test rate limiter." >&2
  exit 1
fi

# ALL THREE, from one value. DIRECT_URL is the one that bites — omit it and Prisma silently
# uses .env.local's production value for every migrate/db command.
exec env \
  DATABASE_URL="$TEST_DB" \
  DIRECT_URL="$TEST_DB" \
  TEST_DATABASE_URL="$TEST_DB" \
  UPSTASH_REDIS_REST_URL="$TEST_UPSTASH" \
  UPSTASH_REDIS_REST_TOKEN="$TEST_UPSTASH_TOKEN" \
  REDIS_URL= \
  "$@"
