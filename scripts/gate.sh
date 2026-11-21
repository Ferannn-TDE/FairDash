#!/usr/bin/env bash
# THE GATE — `npm run gate`. Runs every suite against the test database and, on a full green
# run over a clean tree, writes .gate-pass with the commit it passed on.
#
# WHY THE STAMP — 2026-10-26: 8c0abc7 was pushed while the gate's output was piped through
# `tail`, so nobody saw it pass before the push. scripts/git-hooks/pre-push now refuses any
# push whose commit is not the one in .gate-pass. Docs-only commits are not exempt.
#
# No stamp is written when:
#   • any suite fails (verify-all exits non-zero);
#   • the run is partial (`npm run gate -- --fast`, `--for x`, `--group x`, a suite name);
#   • tracked files differ from HEAD, at the start or the end (the run tested something other
#     than the commit), or HEAD moved during the run.
# So the order is: commit, then gate, then push.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

STAMP=.gate-pass
rm -f "$STAMP"

# The suites read the working tree, so that is what must match HEAD. Untracked files are ignored.
tree_clean() { git diff --quiet HEAD --; }

head_at_start="$(git rev-parse HEAD)"
clean_at_start=yes
tree_clean || clean_at_start=no

npm run test:db:up

# A CLEAN RATE LIMITER for every gate run. The test Upstash stand-in (fairsynq-test-upstash) keeps
# no data of its own: it is an HTTP front for fairsynq-test-redis (docker-compose.test.yml,
# SRH_CONNECTION_STRING), so clearing that one memory-only container clears the rate-limit
# counters. It is addressed BY CONTAINER NAME and flushed from inside, on its own port: no URL or
# token from the environment is used, so this can never reach the dev Redis or anything remote.
# Refused unless that container really is the test compose file's Redis service.
test_redis_labels="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}' fairsynq-test-redis 2>/dev/null || true)"
case "$test_redis_labels" in
  fairsynq-test-redis\|*docker-compose.test.yml*) ;;
  *)
    echo "🛑 gate: the container named fairsynq-test-redis is not the test compose file's Redis service; not flushing." >&2
    exit 1
    ;;
esac
docker exec fairsynq-test-redis redis-cli -p 6379 FLUSHALL >/dev/null

./scripts/with-test-db.sh npx tsx scripts/verify-all.ts "$@"

# Reached only when every counted suite passed (set -e).
if [ "$#" -gt 0 ]; then
  echo "gate: partial run ($*), no push stamp written. Run \`npm run gate\` with no arguments before pushing."
  exit 0
fi
if [ "$clean_at_start" != yes ] || ! tree_clean; then
  echo "gate: tracked files differ from HEAD, so this run did not test a commit. No push stamp written."
  echo "      Commit, then run \`npm run gate\` again before pushing."
  exit 0
fi
if [ "$(git rev-parse HEAD)" != "$head_at_start" ]; then
  echo "gate: HEAD moved during the run. No push stamp written."
  exit 0
fi

echo "$head_at_start" > "$STAMP"
echo "gate: passed on $head_at_start, push stamp written to $STAMP"
