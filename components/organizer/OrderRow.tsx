'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { getStatusConfig } from '@/lib/order-status-config'

export interface OrderRowItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
}

export interface OrderRowDisputeInfo {
  id: string
  status: 'OPEN' | 'ESCALATED' | 'RESOLVED'
}

export interface OrderRowData {
  id: string
  status: string
  total: number
  placedAt: string
  customerName: string
  fulfillmentType: string
  vendorId: string
  vendorName: string
  boothNumber: string | null
  items: OrderRowItem[]
  dispute: OrderRowDisputeInfo | null
}

const FULFILLMENT_LABELS: Record<string, string> = {
  BOOTH_PICKUP:  'Pickup',
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Delivery',
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function OrderRow({
  order,
  onClick,
  showVendor = true,
}: {
  order: OrderRowData
  onClick: () => void
  showVendor?: boolean
}) {
  const cfg = getStatusConfig(order.status)
  const hasIssue = order.dispute && order.dispute.status !== 'RESOLVED'

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#111] border border-white/[0.06] hover:border-white/[0.12] rounded-xl p-4 transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {/* Status pill */}
        <div className="mt-0.5 shrink-0">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider border ${cfg.color} ${cfg.textColor} ${cfg.borderColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotColor}`} />
            {cfg.label}
          </span>
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-sm font-inter font-semibold">
              #{order.id.slice(-6).toUpperCase()}
            </span>
            <span className="text-white/25 text-xs">·</span>
            <span className="text-white/60 text-xs font-inter">{order.customerName}</span>
            {hasIssue && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-[0.6rem] font-bold uppercase tracking-wider">
                <ExclamationTriangleIcon className="w-3 h-3" />
                Dispute
              </span>
            )}
          </div>

          {showVendor && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="text-white/30 text-xs font-inter bg-white/[0.04] px-2 py-0.5 rounded">
                {order.vendorName}
              </span>
              {order.boothNumber && (
                <span className="text-white/20 text-xs font-inter">Booth {order.boothNumber}</span>
              )}
              <span className="text-white/20 text-xs font-inter">
                {FULFILLMENT_LABELS[order.fulfillmentType] ?? order.fulfillmentType}
              </span>
            </div>
          )}

          <div className="flex gap-1 mt-1.5 flex-wrap">
            {order.items.slice(0, 3).map(item => (
              <span key={item.id} className="text-[0.65rem] text-white/25 font-inter bg-white/[0.03] px-1.5 py-0.5 rounded">
                {item.quantity}× {item.name}
              </span>
            ))}
            {order.items.length > 3 && (
              <span className="text-[0.65rem] text-white/20 font-inter">+{order.items.length - 3} more</span>
            )}
          </div>
        </div>

        {/* Amount + time */}
        <div className="shrink-0 text-right">
          <p className="text-white text-sm font-inter font-semibold tabular-nums">
            ${order.total.toFixed(2)}
          </p>
          <p className="text-white/25 text-[0.65rem] font-inter mt-0.5">{timeAgo(order.placedAt)}</p>
        </div>
      </div>
    </button>
  )
}
