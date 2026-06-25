// Shared vendor-earnings display. One component so dashboard / analytics / orders
// label take-home identically and a vendor can't be misled. Settled cash and a
// pending estimate are VISUALLY distinct (solid emerald "$X earned" vs muted
// "~$X pending" with a tilde) — an estimate must never read as cash in hand.

export type EarningsStatus = 'settled' | 'estimated' | 'refunded' | 'reversed' | 'declined'

const fmt = (n: number) => `$${(n ?? 0).toFixed(2)}`

export function EarningsBadge({
  amount,
  status,
  size = 'sm',
}: {
  amount: number
  status: EarningsStatus
  size?: 'sm' | 'lg'
}) {
  const text = size === 'lg' ? 'text-base' : 'text-sm'
  switch (status) {
    case 'settled':
      return <span className={`font-bold text-emerald-400 ${text}`}>{fmt(amount)} <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-400/60">earned</span></span>
    case 'estimated':
      return <span className={`font-bold text-white/70 ${text}`}>~{fmt(amount)} <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-amber-400/70">pending</span></span>
    case 'refunded':
      return <span className={`font-bold text-white/40 ${text}`}>{fmt(amount)} <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-amber-400/70">refunded</span></span>
    case 'reversed':
      return <span className={`font-bold text-white/40 ${text}`}>{fmt(0)} <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-red-400/70">charged back</span></span>
    case 'declined':
      return <span className={`font-semibold text-white/30 ${text}`}>—</span>
  }
}
