'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MinusIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import { useFairCart } from '../../../_contexts/FairCartContext'
import Breadcrumb from '../_components/Breadcrumb'

export default function FairCartPage() {
  const router = useRouter()
  const { fair } = useFair()
  const { items, itemCount, subtotal, updateQty, removeItem } = useFairCart()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const handleCheckout = () => {
    router.push(`/fair/${fair.slug}/checkout`)
  }

  if (itemCount === 0) {
    return (
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-20 text-center text-white">
        <p className="font-bebas text-3xl mb-3">Your cart is empty</p>
        <p className="text-text-gray mb-8">Browse vendors at {fair.name} and add some items.</p>
        <Link
          href={`/fair/${fair.slug}/vendors`}
          className="inline-flex items-center px-6 py-3 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: accentColor }}
        >
          Browse Vendors
        </Link>
      </div>
    )
  }

  const byVendor: Record<string, { vendorName: string; items: typeof items }> = {}
  for (const item of items) {
    if (!byVendor[item.vendorId]) byVendor[item.vendorId] = { vendorName: item.vendorName, items: [] }
    byVendor[item.vendorId].items.push(item)
  }

  return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <Breadcrumb crumbs={[{ label: 'Cart' }]} />
      <h1 className="font-bebas text-3xl sm:text-4xl tracking-wide mb-6 sm:mb-8">Your Cart</h1>

      <div className="flex flex-col lg:flex-row gap-6 sm:gap-8">
        {/* Items */}
        <div className="flex-1 space-y-5 sm:space-y-6">
          {Object.entries(byVendor).map(([vendorId, group]) => (
            <div key={vendorId}>
              <h2 className="font-semibold text-white mb-3 text-sm sm:text-base">{group.vendorName}</h2>
              <div className="space-y-3">
                {group.items.map((item) => (
                  <div
                    key={item.menuItemId}
                    className="bg-bg-card border border-white/10 rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm sm:text-base truncate">{item.name}</p>
                      <p className="text-text-gray text-xs sm:text-sm tabular-nums">${item.price.toFixed(2)} each</p>
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      <button
                        onClick={() => updateQty(item.menuItemId, item.quantity - 1)}
                        className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                      >
                        <MinusIcon className="w-3.5 h-3.5 text-white" />
                      </button>
                      <span className="text-white font-semibold w-5 text-center text-sm tabular-nums">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(item.menuItemId, item.quantity + 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity"
                        style={{ background: accentColor }}
                      >
                        <PlusIcon className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>

                    {/* Line total */}
                    <div className="text-right shrink-0 w-14 sm:w-16">
                      <p className="text-white font-semibold text-sm sm:text-base tabular-nums">
                        ${(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.menuItemId)}
                      className="text-text-gray hover:text-red-400 transition-colors shrink-0"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="lg:w-72 shrink-0">
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5 lg:sticky lg:top-20">
            <h2 className="font-bebas text-xl text-white tracking-wide mb-4">Order Summary</h2>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-text-gray">Subtotal</span>
              <span className="text-white tabular-nums">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mb-4 pb-4 border-b border-white/10">
              <span className="text-text-gray">Service charge</span>
              <span className="text-text-gray text-xs">At checkout</span>
            </div>
            <div className="flex justify-between font-semibold mb-5">
              <span className="text-white">Total</span>
              <span className="text-white tabular-nums">${subtotal.toFixed(2)}+</span>
            </div>
            <button
              onClick={handleCheckout}
              className="w-full py-3 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: accentColor }}
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
