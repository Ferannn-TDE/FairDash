#!/usr/bin/env bash
# Run a command against the LOCAL DEV database (docker-compose.dev.yml), whatever the shell has set.
#
#   ./scripts/with-dev-db.sh npx prisma migrate deploy
#   ./scripts/with-dev-db.sh npx tsx prisma/seed.ts
#
# Sets DATABASE_URL and DIRECT_URL together — the Prisma CLI connects through directUrl, so
# setting only one is how a "local" command reached production before (see with-test-db.sh).
# Clears TEST_DATABASE_URL so lib/db.ts cannot redirect to the test container instead.

set -euo pipefail

DEV_DB="${DEV_DATABASE_URL_OVERRIDE:-postgresql://fairsynq:fairsynq@localhost:54329/fairsynq_dev}"

host="$(printf '%s' "$DEV_DB" | sed -E 's#^[^:]+://([^@]*@)?([^:/]+).*#\2#')"
case "$host" in
  localhost|127.0.0.1|fairsynq-dev-db) ;;
  *)
    echo "🛑 REFUSING: dev DB host resolved to '$host', which is not local." >&2
    exit 1
    ;;
esac

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command…>   e.g. $0 npx prisma migrate deploy" >&2
  exit 2
fi

export DATABASE_URL="$DEV_DB" DIRECT_URL="$DEV_DB"
unset TEST_DATABASE_URL
exec "$@"
