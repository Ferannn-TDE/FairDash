/**
 * THE 2026-07-16/17 POLLUTION COHORT — one declared set, consumed in two independent places.
 *
 * ── WHAT THESE ARE, MEASURED ────────────────────────────────────────────────────────────────
 * 76 `Payout` rows whose `stripeTransferId` does not resolve in Stripe, all on Italian Fest 2026.
 *   • The ORDERS ARE REAL — every one has a `stripePaymentIntentId` AND a `stripeChargeId`, and
 *     every sampled PaymentIntent resolves. They are the operator's own manual test orders
 *     through the real checkout (`customerName: 'Refund Test'`, one Clerk user).
 *   • Only the PAYOUT ROWS are fabricated — written by a test suite's Stripe spy running against
 *     production, before test-DB isolation landed. Fourth incident of that class.
 *   • 76 unambiguous, 0 needing separate treatment. An apparent 38/38 split was an artifact of
 *     joining on `orderId`; joining on (order, vendor) dissolves it — 38 orders carry both a
 *     genuine and a fabricated payout, but NEVER for the same pair.
 *
 * ⚠️ NO REAL MONEY IS IMPLICATED. Stripe has always been in test mode. What was wrong is LEDGER
 * CORRECTNESS going into the real fair — not a debt. Nobody was ever owed anything here.
 *
 * ── WHY IDS AND NOT A DATE WINDOW ───────────────────────────────────────────────────────────
 * A window was the obvious shape and it is UNSAFE, measured: 34 LEGITIMATE payouts fall inside
 * the same 2026-07-12→17 range, so a date rule would have silently suppressed real rows from a
 * money check. Transfer ids are globally unique; this list cannot widen to cover a row nobody
 * has looked at.
 *
 * ── ⛔ LOAD-BEARING IN TWO PLACES — DO NOT PRUNE AS STALE CLEANUP ────────────────────────────
 *   1. `lib/transfer-existence.ts` — suppresses these from the transfer-existence audit, so a
 *      FIFTH pollution incident still fails loudly instead of hiding among them.
 *   2. `lib/vendor-earnings.ts` — makes the written-off slice render as NOTHING on every
 *      vendor-facing surface. Deleting this set would silently show vendors money that was
 *      never sent.
 * Removing an entry re-breaks both. This file deliberately imports NOTHING, so the display path
 * never pulls in Stripe or the DB to read it.
 */

/** Transfer ids that exist in our ledger and have never existed in Stripe. */
export const POLLUTED_TRANSFER_IDS: ReadonlySet<string> = new Set<string>([
  'tr_06l41d6w', 'tr_12qie51w', 'tr_1cfdbjdz', 'tr_1ymi1vsc', 'tr_1z8lo7wn', 'tr_32p0x7rx',
  'tr_3b34xe3p', 'tr_3udd5q06', 'tr_3xec1k6r', 'tr_50wqgxoe', 'tr_530cjvmd', 'tr_5r4pijzz',
  'tr_5y4sg5bd', 'tr_6xq9y2ow', 'tr_7556kbou', 'tr_7fo0sfi7', 'tr_7lxqhe5y', 'tr_7wq4szef',
  'tr_85ds68ug', 'tr_933ve86r', 'tr_974o90jg', 'tr_9ju0p4w1', 'tr_9kujcnd1', 'tr_a89ipt0s',
  'tr_acwngt9g', 'tr_arolc79d', 'tr_awjyreet', 'tr_bbayok0f', 'tr_bud1m4er', 'tr_by1ha1bb',
  'tr_c24o2xio', 'tr_c7o7bgz2', 'tr_c8wypk5w', 'tr_cirx6wk3', 'tr_drfkmpo7', 'tr_dz69nbyr',
  'tr_eom2vgvo', 'tr_f3mlv34n', 'tr_fa55ruvd', 'tr_fb4ila92', 'tr_frka1ir6', 'tr_g2wt1n9q',
  'tr_g34twkkh', 'tr_geptnzh8', 'tr_hciei2c3', 'tr_iuda8abb', 'tr_jkyj1hbp', 'tr_jx4n2ms5',
  'tr_k1tratdv', 'tr_kd5ge2k0', 'tr_kiarrjiw', 'tr_llzha5op', 'tr_lvd5fir0', 'tr_m56hmao2',
  'tr_mghqejid', 'tr_q6o4szng', 'tr_qacm1zj2', 'tr_qhe69cti', 'tr_r53dgypg', 'tr_r8jyfqy6',
  'tr_s8cjnwfx', 'tr_slcv3pan', 'tr_tnj5y7ef', 'tr_u8dp2b8z', 'tr_uidkclps', 'tr_um71pz2v',
  'tr_vqsh7k0r', 'tr_wndlh6u0', 'tr_x03b6pse', 'tr_xaiath6c', 'tr_xakrjqpk', 'tr_yei60cgz',
  'tr_z2q0x5vw', 'tr_zgx2mohu', 'tr_zvfhfqlg', 'tr_zwxa2ene',])

export const POLLUTION_COHORT_REASON =
  'test-suite pollution of prod, 2026-07-16/17 (found 2026-07-28). Real orders, fabricated ' +
  'Payout rows written by a Stripe spy running against production. See CURRENT_STATE §7.'

/** True when this transfer id is one of the fabricated cohort. */
export const isPollutedTransfer = (id: string | null | undefined): boolean =>
  id != null && POLLUTED_TRANSFER_IDS.has(id)
