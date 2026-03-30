/**
 * Vendor Menu — skeleton loading screen
 *
 * Mirrors the exact layout of src/views/VendorDetail.jsx:
 *   - Dark radial-gradient header:
 *       back link → flex row (80×80 logo + name/description/meta)
 *       collapses to flex-col on md (mobile-first)
 *   - "Menu" section heading
 *   - grid-cols-2 md:grid-cols-4 FoodCards — each with square image,
 *       name+price row, description lines, add-to-cart button
 *
 * Placed at app/(event)/[eventSlug]/vendors/[vendorSlug]/loading.tsx so
 * Next.js App Router automatically shows this while the vendor page loads.
 */

import { SkeletonBlock, SkeletonCircle, SkeletonLine } from '@/src/components/ui/skeleton'

// ─── Skeleton food card — mirrors FoodCard exactly ────────────────────────────

function SkeletonFoodCard() {
  return (
    <div className="bg-bg-card rounded-xl md:rounded-2xl border border-white/5 overflow-hidden flex flex-col h-full">
      {/* Square image — mirrors aspect-square gradient area */}
      <SkeletonBlock className="w-full aspect-square rounded-none bg-[#252525]" />

      {/* Content — mirrors p-3 md:p-5 flex flex-col flex-1 */}
      <div className="p-3 md:p-5 flex flex-col flex-1 gap-2">
        {/* Name + price row — flex justify-between min-h-[2.5rem] md:min-h-[3rem] */}
        <div className="flex items-start justify-between gap-2">
          <SkeletonLine className="h-5 md:h-6 flex-1" />
          <SkeletonBlock className="h-5 md:h-6 w-10 md:w-12 flex-shrink-0 rounded-md" />
        </div>

        {/* Description — 2 lines, text-[0.6875rem] md:text-sm */}
        <div className="flex flex-col gap-1.5">
          <SkeletonLine className="h-3 w-full" />
          <SkeletonLine className="h-3 w-3/4" />
        </div>

        {/* Add to cart button — mt-auto py-2 md:py-3.5 rounded-lg md:rounded-xl */}
        <SkeletonBlock className="mt-auto h-8 md:h-12 w-full rounded-lg md:rounded-xl" />
      </div>
    </div>
  )
}

// ─── Loading screen ────────────────────────────────────────────────────────────

export default function VendorMenuLoading() {
  return (
    <>
      <span className="sr-only">Loading menu…</span>

      <div className="pt-20 min-h-screen" aria-hidden="true">

        {/* ── Vendor header — mirrors py-12 md:py-8 border-b border-white/10 ───── */}
        <div className="bg-bg-card py-12 md:py-8 border-b border-white/10">
          <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 animate-pulse">

            {/* Back link — inline-flex items-center gap-2 mb-6 */}
            <SkeletonLine className="h-3.5 w-28 mb-6" />

            {/* Logo + info row — flex items-center gap-5 md:flex-col md:items-start */}
            <div className="flex items-center gap-5 md:flex-col md:items-start">

              {/* Logo — w-20 h-20 rounded-2xl */}
              <SkeletonBlock className="w-20 h-20 rounded-2xl flex-shrink-0" />

              {/* Vendor info */}
              <div className="flex-1 w-full flex flex-col gap-2.5">
                {/* Name — font-bebas text-[clamp(2rem,5vw,3.5rem)] */}
                <SkeletonBlock className="h-9 md:h-12 w-3/4 md:w-1/2 rounded-lg" />

                {/* Description — text-text-gray text-base mb-3 */}
                <div className="flex flex-col gap-1.5">
                  <SkeletonLine className="h-3.5 w-full md:w-3/4" />
                  <SkeletonLine className="h-3.5 w-4/5 md:w-1/2" />
                </div>

                {/* Meta row — cuisine · booth · items — flex items-center gap-4 */}
                <div className="flex items-center gap-4 flex-wrap mt-1">
                  <SkeletonLine className="h-3 w-16" />
                  <SkeletonCircle className="w-1 h-1" />
                  <SkeletonLine className="h-3 w-20" />
                  <SkeletonCircle className="w-1 h-1" />
                  <SkeletonLine className="h-3 w-12" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Menu section — py-10 pb-20 ───────────────────────────────────────── */}
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-10 pb-20">

          {/* "Menu" heading — font-bebas text-[2rem] tracking-wide mb-8 */}
          <SkeletonBlock className="h-8 w-24 rounded-lg mb-8 animate-pulse" />

          {/* Food card grid — grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 animate-pulse">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonFoodCard key={i} />
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
