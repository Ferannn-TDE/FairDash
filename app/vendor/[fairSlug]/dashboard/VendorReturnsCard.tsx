'use client'

import { useState, useEffect, useCallback } from 'react'
import { PackageCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { toastError } from '@/lib/toast-error'

// Vendor RETURNS-TO-CONFIRM (Commit 2, U5). A runner collected an order, couldn't deliver, and
// asked to hand it back — it moves to the pool only when THIS vendor confirms possession. Keyed
// on returnRequestedAt (VOS-independent), so it's a distinct surface from the kitchen lanes
// (which hide RUNNER_COLLECTED). Self-contained: fetches + confirms on its own, renders nothing
// when there are no returns.
//   GET  /api/vendors/[id]/returns
//   POST /api/orders/[id]/confirm-return

interface ReturnRow {
  orderId: string
  ageMin: number
  customerName: string | null
  items: { quantity: number; name: string | null }[]
}

export default function VendorReturnsCard({ vendorId }: { vendorId: string | null | undefined }) {
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vendorId) return
    try {
      const res = await fetch(`/api/vendors/${vendorId}/returns`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) setRows(json.data.returns)
    } catch { /* transient — the interval refetches */ }
  }, [vendorId])

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [load])

  async function confirm(orderId: string) {
    setConfirming(orderId)
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm-return`, { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.success) { toast.success('Return confirmed — back to the pool'); await load() }
      else toastError(json.error?.code, 'Couldn’t confirm the return — please try again')
    } catch { toast.error('Network error — try again') } finally { setConfirming(null) }
  }

  if (rows.length === 0) return null // tight: no surface when there's nothing to confirm

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <PackageCheck className="w-4 h-4 text-amber-400" />
        <h3 className="text-white font-semibold text-sm">Returns to confirm ({rows.length})</h3>
      </div>
      <p className="text-text-gray text-xs">A runner brought an order back. Confirm you have the food — it then returns to the pool for another runner.</p>
      {rows.map(r => (
        <div key={r.orderId} className="flex items-center justify-between gap-3 bg-bg-card border border-white/10 rounded-xl p-3">
          <div>
            <p className="text-white text-sm font-semibold">Order {r.orderId.slice(-8).toUpperCase()} · {r.customerName ?? 'customer'}</p>
            <p className="text-text-gray text-xs mt-0.5">{r.items.map(i => `${i.quantity}× ${i.name ?? 'item'}`).join(', ') || 'items'} · requested {r.ageMin}m ago</p>
          </div>
          <button onClick={() => confirm(r.orderId)} disabled={confirming === r.orderId}
            className="shrink-0 text-xs font-semibold bg-neon-pink text-white rounded-lg px-3 py-2 hover:bg-[#e0006b] disabled:opacity-50 cursor-pointer border-0">
            {confirming === r.orderId ? 'Confirming…' : 'Confirm returned'}
          </button>
        </div>
      ))}
    </div>
  )
}
