/**
 * Runner-fee ACTIVATION gate — the one predicate for "may this fulfillment config be saved".
 *
 * The failure it prevents is runnerFeePercent = 0 BY ABSENCE: delivery enabled while nobody set
 * the split, so a runner earns $0 on a fee-charging delivery (fee share 0 + no tip). But 0 is
 * not always a mistake — volunteer / tips-only runners at a small fair are a legitimate,
 * unusual choice, and there is no other runner-payment mechanism in the system. So this is a
 * DECISION, not a hard block: enabling a runner-fulfilled mode requires EITHER a percent > 0,
 * OR an explicit acknowledgment (runnerTipsOnlyAck) that runners earn tips only. Same principle
 * as every other guarded default here — a value that means something important must be a choice
 * someone made, not one nobody set.
 *
 * PURE — proven with no DB. The config write route (admin fulfillment PATCH) runs this on the
 * MERGED resulting state before persisting.
 */

export interface FeeActivationInput {
  homeDeliveryEnabled: boolean
  curbsideEnabled: boolean
  curbsideMethod: string | null
  runnerFeePercent: number
  runnerTipsOnlyAck: boolean
}

export type FeeActivationResult =
  | { ok: true }
  | { ok: false; code: 'RUNNER_FEE_UNACKNOWLEDGED'; message: string }

/** Runner-fulfilled = home delivery, or curbside where the RUNNER delivers to the car. */
export function isRunnerFulfilledConfig(c: Pick<FeeActivationInput, 'homeDeliveryEnabled' | 'curbsideEnabled' | 'curbsideMethod'>): boolean {
  return c.homeDeliveryEnabled || (c.curbsideEnabled && c.curbsideMethod === 'RUNNER_DELIVERS')
}

export function checkRunnerFeeActivation(c: FeeActivationInput): FeeActivationResult {
  // No runner leg → the split is irrelevant; 0 is fine.
  if (!isRunnerFulfilledConfig(c)) return { ok: true }
  // Runners get a share of the fee.
  if (c.runnerFeePercent > 0) return { ok: true }
  // 0 BY INTENT — the admin confirmed tips-only.
  if (c.runnerTipsOnlyAck) return { ok: true }
  return {
    ok: false,
    code: 'RUNNER_FEE_UNACKNOWLEDGED',
    message:
      'Runner delivery is enabled but the runner fee percent is 0 — runners would earn tips only. ' +
      'Set a runner fee percent above 0, or confirm tips-only (runnerTipsOnlyAck) to proceed.',
  }
}
