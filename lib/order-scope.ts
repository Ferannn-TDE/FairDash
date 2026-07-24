import { Prisma } from '@prisma/client'

/**
 * IN-MODEL ORDERS — the one definition of "orders that count", spread into every aggregate.
 *
 * A voided order (`Order.voidedAt`) is OUT OF MODEL: test junk an admin has struck from the
 * record. It keeps its status and its total, so any aggregate that forgets to exclude it counts
 * it as real work and real money.
 *
 * This exists because the omission kept recurring — it is the same defect on its sixth surface:
 *   1. runner completion rate (fixed: a voided order was scoring a runner)
 *   2. the admin/organizer order log (fixed: 92 "active" when 4 were real, 377 when 152 were)
 *   3–6. the organizer's own dashboard, analytics, stats and vendor tables — the ones a PAYING
 *        CUSTOMER reads. Measured before this landed: 215 completed orders shown against 136
 *        real, and $10,222.38 revenue against $8,810.38 — a ~$1,412 (16%) overstatement of the
 *        organizer's takings, made of deleted test orders.
 *
 * Six surfaces × 22 separate `db.order` queries is 22 chances to forget, which is why this is a
 * NAMED FRAGMENT rather than a `voidedAt: null` literal repeated 22 times: one definition to
 * read, one thing for a guard to look for, and `scripts/test-ghost-guard.ts` asserts no organizer
 * order aggregate is missing it.
 *
 * DELIBERATELY NOT an opt-in here (unlike the order log's `includeVoided`): an organizer never
 * needs "my revenue, including the orders that were struck". Auditing what was voided is an
 * ADMIN need, and the admin log is where that opt-in lives.
 *
 * NOT for money-settlement paths. Payouts, refunds and the reconciler have their own voided
 * handling (a voided order is refused outright by `process-refund`), and an order that was
 * voided after being paid must still reconcile — see the archived-fair money carve-out for the
 * same reasoning.
 */
export const IN_MODEL_ORDERS = { voidedAt: null } satisfies Prisma.OrderWhereInput
