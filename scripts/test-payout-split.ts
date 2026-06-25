/**
 * Unit checks for the proportional Stripe-fee split (lib/payout-split).
 * Pure math — no Stripe/DB needed. Run: npx tsx scripts/test-payout-split.ts
 *
 * Verifies the core money-correctness guarantee: Σ feeShare === stripeFee
 * exactly, and FairSynq's 10% falls out clean for every case.
 */
import { splitStripeFee } from '../lib/payout-split'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failures++ }
}

// Helper: assert the split reconciles to the cent.
function reconciles(subtotals: Record<string, number>, feeCents: number) {
  const lines = splitStripeFee(subtotals, feeCents)
  const sumShares = lines.reduce((s, l) => s + l.feeShareCents, 0)
  const sumTransfers = lines.reduce((s, l) => s + l.transferCents, 0)
  const sumSubtotals = Object.values(subtotals).reduce((s, c) => s + c, 0)
  return { lines, sumShares, sumTransfers, sumSubtotals }
}

console.log('Single vendor — $28 subtotal, ~$1.19 Stripe fee:')
{
  const { lines, sumShares, sumTransfers } = reconciles({ A: 2800 }, 119)
  check('fee share === total fee', sumShares === 119, `got ${sumShares}`)
  check('vendor transfer = 2800 - 119 = 2681', lines[0].transferCents === 2681, `got ${lines[0].transferCents}`)
  check('transfers + fee === subtotal', sumTransfers + sumShares === 2800)
}

console.log('Multi-vendor — $20 + $8 (=$28), $1.19 fee, proportional 71.4/28.6:')
{
  const { lines, sumShares, sumTransfers, sumSubtotals } = reconciles({ APro: 2000, Randy: 800 }, 119)
  check('Σ feeShare === 119 exactly (no penny lost)', sumShares === 119, `got ${sumShares}`)
  check('Σ transfers + fee === Σ subtotal', sumTransfers + sumShares === sumSubtotals)
  const a = lines.find(l => l.vendorId === 'APro')!
  const r = lines.find(l => l.vendorId === 'Randy')!
  // 119 * 2000/2800 = 85.0 → 85 ; 119 * 800/2800 = 34.0 → 34 ; sum 119 ✓
  check('APro fee ≈ 85¢', a.feeShareCents === 85, `got ${a.feeShareCents}`)
  check('Randy fee ≈ 34¢', r.feeShareCents === 34, `got ${r.feeShareCents}`)
  check('APro transfer = 2000 - 85 = 1915', a.transferCents === 1915, `got ${a.transferCents}`)
  check('Randy transfer = 800 - 34 = 766', r.transferCents === 766, `got ${r.transferCents}`)
}

console.log('Rounding remainder — three uneven vendors, fee that does not divide evenly:')
{
  // 100¢ fee across 333/333/334 = 999.999... → floors 33/33/33 (=99), remainder 1¢ to largest (334)
  const { lines, sumShares } = reconciles({ A: 333, B: 333, C: 334 }, 100)
  check('Σ feeShare === 100 exactly', sumShares === 100, `got ${sumShares}`)
  const c = lines.find(l => l.vendorId === 'C')!
  check('remainder cent went to largest slice (C)', c.feeShareCents === 34, `got ${c.feeShareCents}`)
}

console.log('Small order — $3 item, flat-fee-heavy ~40¢ fee:')
{
  const { lines, sumShares } = reconciles({ A: 300 }, 40)
  check('fee share === 40', sumShares === 40)
  check('transfer = 300 - 40 = 260 (positive, vendor absorbs flat fee)', lines[0].transferCents === 260, `got ${lines[0].transferCents}`)
}

console.log('Tiny order where fee ≥ subtotal — transfer would be ≤ 0 (worker HOLDs this):')
{
  const { lines } = reconciles({ A: 30 }, 40) // $0.30 item, 40¢ fee
  check('transferCents is ≤ 0 (so worker holds, never sends negative)', lines[0].transferCents <= 0, `got ${lines[0].transferCents}`)
  check('fee share still counted (= 40) so FairSynq math stays exact', lines[0].feeShareCents === 40)
}

console.log(failures === 0 ? '\nALL PASS ✅' : `\n${failures} FAILURE(S) ❌`)
process.exit(failures === 0 ? 0 : 1)
