import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import MarketplaceNavbar from '../../_components/MarketplaceNavbar'
import Link from 'next/link'
import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline'

export const metadata = { title: 'Order History — FairSynq' }

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  PLACED:      'bg-neon-pink/10 text-neon-pink border-neon-pink/20',
  ACCEPTED:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  PREPARING:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  READY:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  COMPLETED:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  DELIVERED:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CANCELLED:   'bg-red-500/10 text-red-400 border-red-500/20',
  UNCOLLECTED: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const STATUS_LABELS: Record<string, string> = {
  PLACED: 'New', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
  READY: 'Ready', COMPLETED: 'Completed', DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled', UNCOLLECTED: 'Uncollected',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${STATUS_STYLES[status] ?? 'bg-white/5 text-text-gray border-white/10'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AccountOrdersPage() {
  const { userId: clerkId } = await auth()

  let orders: Awaited<ReturnType<typeof fetchOrders>> = []

  if (clerkId) {
    orders = await fetchOrders(clerkId)
  }

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Link href="/account" className="text-text-gray hover:text-white transition-colors text-sm">
              ← Account
            </Link>
            <h1 className="font-bebas text-5xl text-white tracking-wide">Order History</h1>
          </div>

          {orders.length === 0 ? (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-12 text-center">
              <ClipboardDocumentListIcon className="w-12 h-12 text-text-gray/30 mx-auto mb-4" />
              <p className="text-text-gray mb-4">No orders yet. Find a fair and start ordering!</p>
              <Link
                href="/fairs"
                className="inline-flex items-center px-6 py-3 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                Find a Fair
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const itemNames = order.orderItems.map((i) => `${i.menuItem.name} ×${i.quantity}`).join(', ')
                const fairSlug = order.event?.urlSlug
                const trackHref = fairSlug
                  ? `/fair/${fairSlug}/order/${order.id}`
                  : `/account/orders/${order.id}`

                return (
                  <Link
                    key={order.id}
                    href={trackHref}
                    className="block bg-bg-card border border-white/10 rounded-2xl p-5 hover:border-white/20 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-white text-sm">
                            #{order.id.slice(-8).toUpperCase()}
                          </span>
                          <span className="text-text-gray text-xs">·</span>
                          <span className="text-text-gray text-xs">
                            {order.vendor.name}
                            {order.vendor.boothNumber ? ` (Booth ${order.vendor.boothNumber})` : ''}
                          </span>
                          <StatusBadge status={order.status} />
                        </div>
                        <p className="text-white/60 text-xs line-clamp-1">{itemNames}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</p>
                        <p className="text-text-gray text-xs mt-0.5">
                          {new Date(order.placedAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchOrders(clerkId: string) {
  const dbUser = await db.user.findUnique({ where: { clerkId } })
  if (!dbUser) return []

  return db.order.findMany({
    where: { customerId: dbUser.id },
    orderBy: { placedAt: 'desc' },
    take: 50,
    include: {
      vendor: { select: { name: true, boothNumber: true } },
      event:  { select: { urlSlug: true, name: true } },
      orderItems: {
        include: { menuItem: { select: { name: true } } },
      },
    },
  })
}
