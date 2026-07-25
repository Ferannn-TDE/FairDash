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

# ALL THREE, from one value. DIRECT_URL is the one that bites — omit it and Prisma silently
# uses .env.local's production value for every migrate/db command.
exec env \
  DATABASE_URL="$TEST_DB" \
  DIRECT_URL="$TEST_DB" \
  TEST_DATABASE_URL="$TEST_DB" \
  "$@"
