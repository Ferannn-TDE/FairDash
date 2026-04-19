import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import MarketplaceNavbar from '../../../_components/MarketplaceNavbar'
import Link from 'next/link'
import { MapPinIcon } from '@heroicons/react/24/outline'

export const metadata = { title: 'Order Detail — FairSynq' }

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
  READY: 'Ready for pickup', COMPLETED: 'Completed', DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled', UNCOLLECTED: 'Uncollected',
}

const TIMELINE = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']

interface Props {
  params: { orderId: string }
}

export default async function OrderDetailPage({ params }: Props) {
  const { userId: clerkId } = await auth()
  if (!clerkId) notFound()

  const dbUser = await db.user.findUnique({ where: { clerkId } })
  if (!dbUser) notFound()

  const order = await db.order.findFirst({
    where: { id: params.orderId, customerId: dbUser.id },
    include: {
      vendor: { select: { name: true, boothNumber: true } },
      event:  { select: { urlSlug: true, name: true } },
      orderItems: {
        include: { menuItem: { select: { name: true, imageUrl: true, price: true } } },
      },
    },
  })

  if (!order) notFound()

  const fairSlug = order.event?.urlSlug
  const trackHref = fairSlug ? `/fair/${fairSlug}/order/${order.id}` : null
  const isActive = !['COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED'].includes(order.status)
  const currentStep = TIMELINE.indexOf(order.status)

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[52rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm mb-6">
            <Link href="/account/orders" className="text-text-gray hover:text-white transition-colors">
              Order History
            </Link>
            <span className="text-text-gray/40">›</span>
            <span className="text-white">#{order.id.slice(-8).toUpperCase()}</span>
          </div>

          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
            <div>
              <h1 className="font-bebas text-4xl text-white tracking-wide mb-1">
                Order #{order.id.slice(-8).toUpperCase()}
              </h1>
              <p className="text-text-gray text-sm">
                {order.vendor.name}
                {order.vendor.boothNumber ? ` · Booth ${order.vendor.boothNumber}` : ''}
                {order.event?.name ? ` · ${order.event.name}` : ''}
              </p>
            </div>
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[order.status] ?? 'bg-white/5 text-text-gray border-white/10'}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>

          {/* Status timeline — only for active orders */}
          {isActive && currentStep >= 0 && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-5 mb-5">
              <h2 className="font-bebas text-lg tracking-wide text-white mb-4">Order Progress</h2>
              <div className="flex items-center gap-0">
                {TIMELINE.map((step, i) => {
                  const done = i <= currentStep
                  const isLast = i === TIMELINE.length - 1
                  return (
                    <div key={step} className="flex items-center flex-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[0.6rem] font-bold shrink-0 transition-colors ${done ? 'bg-neon-pink text-white' : 'bg-white/10 text-text-gray'}`}>
                        {i + 1}
                      </div>
                      {!isLast && (
                        <div className={`flex-1 h-0.5 transition-colors ${i < currentStep ? 'bg-neon-pink' : 'bg-white/10'}`} />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between mt-2">
                {TIMELINE.map((step) => (
                  <span key={step} className="text-[0.5625rem] text-text-gray text-center flex-1 first:text-left last:text-right px-0.5">
                    {STATUS_LABELS[step] ?? step}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Items */}
          <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden mb-5">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="font-bebas text-lg tracking-wide text-white">Items Ordered</h2>
            </div>
            <div className="divide-y divide-white/5">
              {order.orderItems.map((item) => (
                <div key={item.id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {item.menuItem.imageUrl ? (
                      <img src={item.menuItem.imageUrl} alt={item.menuItem.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                        <span className="text-lg">🍽️</span>
                      </div>
                    )}
                    <div>
                      <p className="text-white text-sm font-semibold">{item.menuItem.name}</p>
                      <p className="text-text-gray text-xs">${item.unitPrice.toFixed(2)} each</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white text-sm font-semibold">×{item.quantity}</p>
                    <p className="text-neon-pink text-xs font-bold">${item.subtotal.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5 mb-5">
            <h2 className="font-bebas text-lg tracking-wide text-white mb-4">Payment Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-text-gray">
                <span>Subtotal</span>
                <span>${order.subtotal.toFixed(2)}</span>
              </div>
              {order.deliveryFee != null && (
                <div className="flex justify-between text-text-gray">
                  <span>Delivery Fee</span>
                  <span>${order.deliveryFee.toFixed(2)}</span>
                </div>
              )}
              {order.serviceCharge != null && (
                <div className="flex justify-between text-text-gray">
                  <span>Service Charge</span>
                  <span>${order.serviceCharge.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-white font-bold pt-2 border-t border-white/10">
                <span>Total</span>
                <span className="text-neon-pink">${order.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Fulfillment */}
          {order.fulfillmentType === 'HOME_DELIVERY' && order.deliveryStreet && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-5 mb-5">
              <div className="flex items-center gap-2 mb-2">
                <MapPinIcon className="w-4 h-4 text-neon-pink" />
                <h2 className="font-bebas text-lg tracking-wide text-white">Delivery Address</h2>
              </div>
              <p className="text-text-gray text-sm">
                {order.deliveryStreet}, {order.deliveryCity} {order.deliveryZip}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            {isActive && trackHref && (
              <Link
                href={trackHref}
                className="flex-1 text-center py-3 rounded-xl bg-neon-pink text-white font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                Track Order
              </Link>
            )}
            <Link
              href="/account/orders"
              className="flex-1 text-center py-3 rounded-xl bg-white/5 border border-white/10 text-white font-semibold text-sm hover:bg-white/10 transition-colors"
            >
              Back to Order History
            </Link>
          </div>

        </div>
      </div>
    </>
  )
}
