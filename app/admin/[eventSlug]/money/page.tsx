'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { Banknote, Lock, Snowflake, AlertTriangle, RotateCcw } from 'lucide-react'

// ─── Admin MONEY panel ────────────────────────────────────────────────────────
//
// PURE WIRING — this page surfaces the C1 admin money controls that already exist and are
// already proven (94/94 in c1-admin-money-control-test). It adds NO money logic:
//
//   GET  /api/admin/events/[id]/money          → the ledger view rendered below
//   POST /api/admin/events/[id]/money/payout   → HOLD / RELEASE / CANCEL a pending payout
//   POST /api/admin/events/[id]/money/freeze   → freeze / unfreeze a payee's payouts
//   POST /api/admin/events/[id]/money/refund   → refund (through the single refund engine)
//
// All four ride requireAdminFairContext (the proven chokepoint) and every action is
// attributed to the acting admin in AdminMoneyAction. This page must call THESE routes —
// never the organizer refund route, which hardcodes actorRole 'organizer' and skips the
// admin audit table.
//
// DISPLAY RULE: every LEDGER figure below is the API's number rendered verbatim. This page
// NEVER re-derives ledger money — a second source of truth is the mistake the whole payout
// design avoids. Settled (paid) and owed (payable/held) are shown as DISTINCT figures, never
// blended, so an estimate can never read as cash in hand.
//
// THE ONE EXCEPTION, and why it obeys the rule rather than breaks it: the vendors' "Estimated
// (pre-accrual)" line. It is NOT recomputed here — it is the API's figure from the SAME shared
// helper the vendor's own screens use (lib/vendor-earnings), surfaced so pre-payout money is
// not invisible to the admin. It is kept in its OWN field, given a distinct (dashed, sky, "~")
// treatment unlike any ledger tone, and NEVER blended into the four ledger figures — the very
// "distinct, never reads as cash" discipline this rule exists to enforce.

interface Totals {
  payableCents: number
  adminHeldCents: number
  cancelledCents: number
  paidCents: number
}
interface VendorEarning {
  id: string; orderId: string; vendorId: string
  subtotalCents: number; netCents: number | null
  status: string; stripeTransferId: string | null
  vendor: { name: string; payoutsFrozenAt: string | null; payoutsFrozenReason: string | null }
}
interface RunnerEarning {
  id: string; orderId: string; runnerId: string; amountCents: number
  status: string; stripeTransferId: string | null
  runner: { payoutsFrozenAt: string | null; payoutsFrozenReason: string | null; user: { name: string | null } | null }
}
interface AdminAction {
  id: string; adminClerkId: string; action: string
  payeeType: string; payeeId: string; amountCents: number | null
  reason: string; createdAt: string
}
interface MoneyView {
  fair: { id: string; name: string; urlSlug: string }
  platformBalance: { availableCents: number; pendingCents: number } | null
  platformBalanceNote: string
  vendors: {
    totals: Totals
    estimatedPreAccrual: { cents: number; orderCount: number }
    estimatedPreAccrualNote: string
    frozen: { vendorId: string; name: string; reason: string | null }[]
    earnings: VendorEarning[]
  }
  runners: { totals: Totals; earnings: RunnerEarning[] }
  organizer: { totals: Totals; payee: { id: string; name: string; payoutsFrozenAt: string | null } | null }
  passiveHolds: { orderId: string; vendorId: string; amountCents: number; reason: string }[]
  recentAdminActions: AdminAction[]
}

const money = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Stat({ label, value, sub, tone = 'default' }: {
  label: string; value: string; sub?: string
  tone?: 'default' | 'settled' | 'held' | 'cancelled'
}) {
  const c = {
    default:   'text-white',
    settled:   'text-emerald-400',   // real, banked money
    held:      'text-amber-400',     // admin-held — still ours, not paid
    cancelled: 'text-white/40',      // never to be paid
  }[tone]
  return (
    <div className="bg-bg-card rounded-xl border border-white/10 px-4 py-3">
      <p className="text-[0.6rem] uppercase tracking-wider text-text-gray font-semibold mb-1">{label}</p>
      <p className={`font-bebas text-2xl tracking-wide leading-none tabular-nums ${c}`}>{value}</p>
      {sub && <p className="text-[0.6rem] text-text-gray mt-1">{sub}</p>}
    </div>
  )
}

/** Every admin money action REQUIRES a stated reason — the API rejects a blank one
 *  (REASON_REQUIRED), because the AdminMoneyAction row is the defence when a payee
 *  contests it. So the UI must collect it, not invent one. */
function ReasonPrompt({ title, confirmLabel, onConfirm, onCancel, danger }: {
  title: string; confirmLabel: string
  onConfirm: (reason: string) => void; onCancel: () => void; danger?: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 w-full max-w-md space-y-4">
        <p className="text-white font-semibold text-sm">{title}</p>
        <div>
          <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
            Reason (required — recorded in the audit trail)
          </label>
          <input
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. suspected fraud — investigating"
            className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-semibold hover:bg-white/10 cursor-pointer">
            Cancel
          </button>
          <button
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className={`px-4 py-2 rounded-xl text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-neon-pink hover:bg-[#e0006b]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

type PendingAction =
  | { kind: 'payout'; payeeType: 'vendor' | 'runner' | 'organizer'; action: 'HOLD' | 'RELEASE' | 'CANCEL'; orderId?: string; vendorId?: string; title: string; danger?: boolean }
  | { kind: 'freeze'; payeeType: 'vendor' | 'runner' | 'organizer'; payeeId: string; frozen: boolean; title: string; danger?: boolean }

export default function AdminMoneyPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [data, setData] = useState<MoneyView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/admin/events/${params.eventSlug}/money`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) { setError(json.error?.message ?? 'Failed to load money view'); return }
        setData(json.data as MoneyView)
      })
      .catch(() => setError('Failed to load money view'))
      .finally(() => setLoading(false))
  }, [params.eventSlug])

  useEffect(() => { load() }, [load])

  async function run(reason: string) {
    if (!pending) return
    setActing(true)
    setActionError(null)
    try {
      const url = `/api/admin/events/${params.eventSlug}/money/${pending.kind}`
      const body = pending.kind === 'payout'
        ? { payeeType: pending.payeeType, action: pending.action, orderId: pending.orderId, vendorId: pending.vendorId, reason }
        : { payeeType: pending.payeeType, payeeId: pending.payeeId, frozen: pending.frozen, reason }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Action failed')
      setPending(null)
      load() // re-read the ledger — never patch the numbers locally
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(false)
    }
  }

  if (loading) return <div className="p-6 text-text-gray text-sm">Loading money view…</div>
  if (error)   return <div className="p-6 text-red-400 text-sm">{error}</div>
  if (!data)   return null

  const { vendors, runners, organizer, platformBalance, passiveHolds, recentAdminActions } = data

  return (
    <div className="p-6 md:p-4 space-y-6 max-w-[80rem]">
      <div className="flex items-center gap-2">
        <Banknote className="w-5 h-5 text-neon-pink" />
        <h1 className="font-bebas text-3xl tracking-wide text-white leading-none">
          Money <span className="text-neon-pink">Control</span>
        </h1>
      </div>

      {actionError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-300 text-xs">{actionError}</p>
        </div>
      )}

      {/* Platform balance — labelled account-wide, NOT this fair's, exactly as the API says.
          Stripe has no concept of fairs; presenting it as this fair's money would be a lie. */}
      {platformBalance && (
        <div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <Stat label="Platform Available" value={money(platformBalance.availableCents)} tone="settled" />
            <Stat label="Platform Pending" value={money(platformBalance.pendingCents)} />
          </div>
          <p className="text-[0.6rem] text-text-gray mt-1.5">{data.platformBalanceNote}</p>
        </div>
      )}

      {/* Per-payee ledger. SETTLED (paid) and OWED (payable/held) are separate figures —
          never blended, so an estimate can't read as cash in hand. */}
      {([
        { key: 'vendors',   label: 'Vendors',   t: vendors.totals },
        { key: 'runners',   label: 'Runners',   t: runners.totals },
        { key: 'organizer', label: 'Organizer', t: organizer.totals },
      ] as const).map(({ key, label, t }) => (
        <div key={key} className="space-y-2">
          <h2 className="font-bebas text-lg tracking-wide text-white">{label}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Paid (settled)" value={money(t.paidCents)} tone="settled" sub="Money that has left the platform" />
            <Stat label="Payable (owed)" value={money(t.payableCents)} sub="Accrued, not yet paid" />
            <Stat label="Admin-held" value={money(t.adminHeldCents)} tone="held" sub="Held by an admin — not paid" />
            <Stat label="Cancelled" value={money(t.cancelledCents)} tone="cancelled" sub="Never to be paid" />
          </div>

          {/* PRE-ACCRUAL ESTIMATE (vendors only) — deliberately NOT a ledger figure, and styled
              to say so: dashed border, sky tone (unlike settled/held/cancelled), a leading "~".
              It exists because the ledger is written only at accrual, so pre-payout money the
              vendor already sees as "~pending" was invisible here. Same helper as the vendor →
              cannot drift. Never blended into the four ledger figures above. */}
          {key === 'vendors' && vendors.estimatedPreAccrual.cents > 0 && (
            <div className="bg-bg-card/40 border border-dashed border-sky-400/30 rounded-xl px-4 py-3">
              <p className="text-[0.6rem] uppercase tracking-wider text-sky-300/70 font-semibold mb-1">
                Estimated · pre-accrual (not settled, not in the ledger)
              </p>
              <p className="font-bebas text-2xl tracking-wide leading-none tabular-nums text-sky-300/80">
                ~{money(vendors.estimatedPreAccrual.cents)}
              </p>
              <p className="text-[0.6rem] text-text-gray mt-1">
                {vendors.estimatedPreAccrual.orderCount} order{vendors.estimatedPreAccrual.orderCount !== 1 ? 's' : ''} not yet accrued — the same estimate the vendor sees. Becomes “Payable” once the payout accrues.
              </p>
            </div>
          )}
        </div>
      ))}

      {/* Frozen payees — the kill-switch state, with the release control. */}
      {vendors.frozen.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-bebas text-lg tracking-wide text-white flex items-center gap-2">
            <Snowflake className="w-4 h-4 text-amber-400" /> Frozen vendors
          </h2>
          <div className="space-y-1.5">
            {vendors.frozen.map(f => (
              <div key={f.vendorId} className="flex items-center justify-between gap-3 bg-bg-card border border-amber-500/25 rounded-xl px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-white font-semibold truncate">{f.name}</p>
                  <p className="text-xs text-text-gray truncate">{f.reason ?? 'No reason recorded'}</p>
                </div>
                <button
                  onClick={() => setPending({ kind: 'freeze', payeeType: 'vendor', payeeId: f.vendorId, frozen: false, title: `Unfreeze payouts for ${f.name}?` })}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-semibold hover:bg-white/10 cursor-pointer"
                >
                  Unfreeze
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-order vendor earnings + the HOLD / RELEASE / CANCEL controls. */}
      <div className="space-y-2">
        <h2 className="font-bebas text-lg tracking-wide text-white">Vendor payouts</h2>
        {vendors.earnings.length === 0 ? (
          <p className="text-text-gray text-xs">No vendor earnings for this fair yet.</p>
        ) : (
          <div className="space-y-1.5">
            {vendors.earnings.map(e => {
              const isPaid = e.status === 'paid'
              const isHeld = e.status === 'held'
              const isCancelled = e.status === 'cancelled'
              return (
                <div key={e.id} className="grid grid-cols-[1fr_auto] items-center gap-3 bg-bg-card border border-white/10 rounded-xl px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-semibold truncate">
                      {e.vendor.name}
                      <span className="ml-2 text-[0.6rem] uppercase tracking-wide text-text-gray">{e.status}</span>
                    </p>
                    <p className="text-xs text-text-gray tabular-nums">
                      {isPaid
                        ? <>Paid {money(e.netCents)} <span className="text-emerald-400/70">settled</span></>
                        : <>Owed {money(e.subtotalCents)} <span className="text-text-gray/60">before Stripe fee</span></>}
                      {' · '}order {e.orderId.slice(-8).toUpperCase()}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {/* Money that has already left cannot be held — the API refuses it
                        (ALREADY_PAID), so the UI doesn't offer it. */}
                    {!isPaid && !isCancelled && (
                      isHeld ? (
                        <button
                          onClick={() => setPending({ kind: 'payout', payeeType: 'vendor', action: 'RELEASE', orderId: e.orderId, vendorId: e.vendorId, title: `Release ${e.vendor.name}'s payout for this order?` })}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/15 cursor-pointer"
                        >
                          Release
                        </button>
                      ) : (
                        <button
                          onClick={() => setPending({ kind: 'payout', payeeType: 'vendor', action: 'HOLD', orderId: e.orderId, vendorId: e.vendorId, title: `Hold ${e.vendor.name}'s payout for this order?` })}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-semibold hover:bg-amber-500/15 cursor-pointer"
                        >
                          <Lock className="w-3 h-3 inline mr-1" />Hold
                        </button>
                      )
                    )}
                    {!isPaid && !isCancelled && (
                      <button
                        onClick={() => setPending({ kind: 'payout', payeeType: 'vendor', action: 'CANCEL', orderId: e.orderId, vendorId: e.vendorId, danger: true, title: `Cancel ${e.vendor.name}'s payout for this order? This is terminal — it will never be paid.` })}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold hover:bg-red-500/15 cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                    {!e.vendor.payoutsFrozenAt && (
                      <button
                        onClick={() => setPending({ kind: 'freeze', payeeType: 'vendor', payeeId: e.vendorId, frozen: true, danger: true, title: `Freeze ALL payouts for ${e.vendor.name}? Every payout of theirs is blocked until you unfreeze.` })}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-text-gray text-xs font-semibold hover:bg-white/10 cursor-pointer"
                      >
                        <Snowflake className="w-3 h-3 inline mr-1" />Freeze
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Runner payouts — same controls, per order. */}
      {runners.earnings.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-bebas text-lg tracking-wide text-white">Runner payouts</h2>
          <div className="space-y-1.5">
            {runners.earnings.map(e => {
              const isPaid = e.status === 'paid'
              const isHeld = e.status === 'held'
              const isCancelled = e.status === 'cancelled'
              const name = e.runner?.user?.name ?? 'Runner'
              return (
                <div key={e.id} className="grid grid-cols-[1fr_auto] items-center gap-3 bg-bg-card border border-white/10 rounded-xl px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-semibold truncate">
                      {name}<span className="ml-2 text-[0.6rem] uppercase tracking-wide text-text-gray">{e.status}</span>
                    </p>
                    <p className="text-xs text-text-gray tabular-nums">
                      {isPaid ? <>Paid {money(e.amountCents)} <span className="text-emerald-400/70">settled</span></> : <>Owed {money(e.amountCents)}</>}
                      {' · '}order {e.orderId.slice(-8).toUpperCase()}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {!isPaid && !isCancelled && (
                      isHeld ? (
                        <button
                          onClick={() => setPending({ kind: 'payout', payeeType: 'runner', action: 'RELEASE', orderId: e.orderId, title: `Release ${name}'s payout for this order?` })}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/15 cursor-pointer"
                        >
                          Release
                        </button>
                      ) : (
                        <button
                          onClick={() => setPending({ kind: 'payout', payeeType: 'runner', action: 'HOLD', orderId: e.orderId, title: `Hold ${name}'s payout for this order?` })}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-semibold hover:bg-amber-500/15 cursor-pointer"
                        >
                          <Lock className="w-3 h-3 inline mr-1" />Hold
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Passive holds — NOT admin holds. Kept visually distinct so an admin never mistakes
          "waiting for the vendor to connect Stripe" for "I stopped this". */}
      {passiveHolds.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-bebas text-lg tracking-wide text-white">Waiting on the payee</h2>
          <p className="text-xs text-text-gray">
            Not admin holds — these pay themselves out automatically once the payee connects Stripe.
          </p>
          <div className="space-y-1.5">
            {passiveHolds.map(h => (
              <div key={`${h.orderId}-${h.vendorId}`} className="flex items-center justify-between bg-bg-card border border-white/10 rounded-xl px-4 py-2.5">
                <p className="text-xs text-text-gray">order {h.orderId.slice(-8).toUpperCase()} · {h.reason}</p>
                <p className="text-sm text-white tabular-nums">{money(h.amountCents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The audit trail, surfaced. Every action here is attributed to the acting admin
          (AdminMoneyAction.adminClerkId) — this is the record if a payee contests it. */}
      <div className="space-y-2">
        <h2 className="font-bebas text-lg tracking-wide text-white flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-text-gray" /> Recent admin money actions
        </h2>
        {recentAdminActions.length === 0 ? (
          <p className="text-text-gray text-xs">No admin money actions on this fair yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recentAdminActions.map(a => (
              <div key={a.id} className="grid grid-cols-[1fr_auto] gap-3 bg-bg-card border border-white/10 rounded-xl px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-white">
                    <span className="font-semibold">{a.action}</span>
                    <span className="text-text-gray"> · {a.payeeType}</span>
                    {a.amountCents != null && <span className="text-text-gray tabular-nums"> · {money(a.amountCents)}</span>}
                  </p>
                  <p className="text-xs text-text-gray truncate">{a.reason}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[0.6rem] text-text-gray">{new Date(a.createdAt).toLocaleString()}</p>
                  <p className="text-[0.6rem] text-text-gray/60 truncate max-w-[12rem]">by {a.adminClerkId}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <ReasonPrompt
          title={pending.title}
          confirmLabel={acting ? 'Working…' : 'Confirm'}
          danger={pending.danger}
          onCancel={() => { setPending(null); setActionError(null) }}
          onConfirm={run}
        />
      )}
    </div>
  )
}
