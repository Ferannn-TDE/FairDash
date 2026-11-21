'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MinusIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import { useFairCart } from '../../../_contexts/FairCartContext'
import Breadcrumb from '../_components/Breadcrumb'
import {
  dishKeyOf,
  ORDER_ITEM_LIMIT_MESSAGE,
  QUANTITY_LIMIT_MESSAGE,
  type OrderLimitCode,
} from '@/lib/order-limits'

/** The fixed sentence for a limit, as the + button's hover text. */
function limitTitle(reason: OrderLimitCode | null): string | undefined {
  if (reason === 'ORDER_ITEM_LIMIT') return ORDER_ITEM_LIMIT_MESSAGE
  if (reason === 'QUANTITY_LIMIT') return QUANTITY_LIMIT_MESSAGE
  return undefined
}

export default function FairCartPage() {
  const router = useRouter()
  const { fair } = useFair()
  // Prices come from the cart's lib/checkout-total.ts pricing (the calculator checkout charges with).
  // Order limits (Jordan, Nov 17; lib/order-limits.ts): a line's + stops when all sizes of its dish
  // add up to 5, or at 15 in the whole cart. The 15-item sentence shows once, above the summary; a
  // full dish shows its sentence under that line only.
  const { items, itemCount, subtotal, pricing, updateQty, removeItem, addBlockReason, atOrderLimit } = useFairCart()
  const money = (cents: number | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`
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
                      <p className="text-text-gray text-xs sm:text-sm tabular-nums">{money(pricing.unitCents[item.menuItemId])} each</p>
                      {addBlockReason(dishKeyOf(item)) === 'QUANTITY_LIMIT' && (
                        <p className="mt-1 text-xs leading-snug text-amber-300" role="status">
                          {QUANTITY_LIMIT_MESSAGE}
                        </p>
                      )}
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
                        disabled={addBlockReason(dishKeyOf(item)) !== null}
                        title={limitTitle(addBlockReason(dishKeyOf(item)))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: accentColor }}
                      >
                        <PlusIcon className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>

                    {/* Line total */}
                    <div className="text-right shrink-0 w-14 sm:w-16">
                      <p className="text-white font-semibold text-sm sm:text-base tabular-nums">
                        {money(pricing.lineCents[item.menuItemId])}
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
          {atOrderLimit && (
            <p className="mb-3 text-xs leading-snug text-amber-300" role="status">
              {ORDER_ITEM_LIMIT_MESSAGE}
            </p>
          )}
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5 lg:sticky lg:top-20">
            <h2 className="font-bebas text-xl text-white tracking-wide mb-4">Order Summary</h2>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-text-gray">Subtotal</span>
              <span className="text-white tabular-nums">${(subtotal ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mb-4 pb-4 border-b border-white/10">
              <span className="text-text-gray">Service charge</span>
              <span className="text-text-gray text-xs">At checkout</span>
            </div>
            <div className="flex justify-between font-semibold mb-5">
              <span className="text-white">Total</span>
              <span className="text-white tabular-nums">${(subtotal ?? 0).toFixed(2)}+</span>
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
