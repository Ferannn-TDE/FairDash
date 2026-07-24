# Cold-event walk — Phase 2

**Date:** 2026-07-24 · **Head:** `33cad88` · **Safe window:** `redis=unreachable, worker=unknown`
(verified via `/api/health` before any write — no sweep could act on rows created here).

## Scope and honesty note

Tested at the **data layer** — the shared query cores the routes delegate to (`getFairOrders`,
`getFairVendors`, `computeRunnerCompletionRates`, `toPublicFairCard`, `vendorReady`) — because the
HTTP routes require a Clerk session this shell cannot mint. The auth chokepoint itself
(`requireAdminFairContext`) is covered separately by `scripts/p6-admin-fair-chokepoint-proof.ts`,
which passed in this run (boundary group, below). So this walk proves the **scoping and
empty-state** of the query cores with two fairs in the table; it does not exercise the
auth+HTTP stack.

## Writes performed (the complete list)

Only `Event` was written, exactly as pre-declared. **Archive, no delete.**

| Model | Op | Id | When |
|---|---|---|---|
| `Event` | create (UPCOMING) | `cmryfqsqa0000u9isqwcszdf4` (`cold-walk-h643ej`) | 2026-07-24T04:23:47Z |
| `Event` | update `archivedAt` | `cmryfqsqa0000u9isqwcszdf4` | 2026-07-24T04:23:52Z |
| `Event` | create (UPCOMING) | `cmryfrep400008v3xar23tur2` (`cold-walk-akof2p`) | 2026-07-24T04:24:16Z |
| `Event` | update `archivedAt` | `cmryfrep400008v3xar23tur2` | 2026-07-24T04:24:19Z |

**Two cold events exist** (a harness re-run after a self-inflicted assertion bug — see below).
Both are `UPCOMING` **and** `archivedAt` set, so neither surfaces on any public or customer path.
Left archived per the task's "no hard deletes". They can be hard-deleted later if desired; both
are named `COLD-WALK … (test — safe to delete)`.

Created **UPCOMING** deliberately: the public marketplace filters to `status: ACTIVE`
(`lib/fairs.ts:156`), so a cold event can never appear on the live site during the test.

## Assertions and results — 19/19 pass (final run)

### [2] Empty-state honesty (cold event)
| Assertion | Result |
|---|---|
| order log: `orders` empty | ✅ |
| order log: `total` is a real `0` from `count()`, not a cap | ✅ |
| order log: every tab count `0` — `{all:0,active:0,completed:0,issues:0}` (no fabricated badge) | ✅ |
| order log: `nextCursor` null | ✅ |
| money: vendor/runner/organizer earnings all `0` | ✅ |
| money: audit trail empty | ✅ |
| vendor roster empty + honest readiness (`approvedCount:0, notReadyCount:0`) | ✅ |
| `vendorReady({availableMenuCount:0})` = `false` (no optimistic default for a no-menu vendor) | ✅ |
| completion: empty roster → empty map (no rows invented) | ✅ |
| public card `vendorCount:0` renders as `0` (not hidden, not faked) | ✅ |

### [3] Cross-fair isolation (B = cold, A = Italian Fest 2026), with positive controls
| Assertion | Result |
|---|---|
| **POSITIVE CONTROL:** fair A order log returns data (`total=152`) | ✅ |
| isolation: fair B order log contains **none** of A's orders | ✅ |
| **POSITIVE CONTROL:** fair A roster has vendors (`20`) | ✅ |
| isolation: fair B roster empty | ✅ |
| **POSITIVE CONTROL:** fair A has vendor earnings (`244`) | ✅ |
| isolation: fair B money scoped to B only (`0`) | ✅ |

The positive controls make the isolation non-vacuous: the same query core that returns 152
orders / 20 vendors / 244 earnings for A returns 0 for B, with two rows in `Event`.

### [4] Archive → soft-delete money floor (both sides asserted)
| Assertion | Result |
|---|---|
| customer-facing (`archivedAt: null`): archived fair **HIDDEN** | ✅ |
| money/audit (`includeArchived`, i.e. no `archivedAt` clause): archived fair **REACHABLE** | ✅ |
| public marketplace never lists the cold/archived fair | ✅ |

This exercises the invariant in `PROJECT_INVARIANTS.md` → _soft-delete money floor_
(`lib/organizer-fair-context.ts:57` default `archivedAt: null`; money paths pass
`includeArchived`).

### [5] Suite gate
`npx tsx scripts/verify-all.ts --group boundary` (no product code changed; the boundary group is
the code-level guarantee behind the data-layer isolation above): **ALL 9 SUITES PASS** — including
`p6-admin-chokepoint`, `runner-boundary`, `fair-open-gate`, `preview-bypass`, the organizer gates.

## Anything that rendered a value it could not have known

**None on the product side.** Every empty state was an honest zero/empty, and every readiness/
completion value over an empty set was `false` / `1.0-by-rule` / empty-map — no fabricated
measurement.

**One harness self-inflicted failure, reported for completeness:** the first run showed 3 FAILs.
All three were the test harness calling `.length` on `getFairVendors(...)`, which returns
`{ vendors, nextCursor, readiness }` (`lib/fair-vendors.ts:126`), not an array — a bug in my
assertion, not the product. Corrected (`.vendors`), re-ran, 19/19. This is itself a small proof
that the positive controls work: the harness bug surfaced as a failed positive control (`fair A
has vendors — A=undefined`), not as a silent pass.

## Not fixed (report-only, per task)

- The two cold `Event` rows remain archived. Recommend a later hard-delete of both test rows once
  no longer useful (they are inert: UPCOMING + archived).
- Nothing else surfaced.

## Cross-reference

The Phase 1 findings (FAILED-marker taxonomy, the `stripeVerified` cached-boolean class, the
unfloored runner-facing completion rate) are in `docs/reports/failed-marker-taxonomy.md`. This
walk did not touch those code paths.
