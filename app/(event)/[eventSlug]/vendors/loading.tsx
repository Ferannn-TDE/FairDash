/**
 * Vendor List — skeleton loading screen
 *
 * Mirrors the exact layout of src/views/Vendors.jsx:
 *   - Dark radial-gradient header with centered title, subtitle, search bar
 *   - Filter pills row
 *   - Section heading + count row
 *   - 6 vendor cards: grid-cols-2 → sm:auto-fill (≥260px) — each with square image
 *
 * Placed at app/(event)/[eventSlug]/vendors/loading.tsx so Next.js App Router
 * automatically wraps the page in React Suspense and shows this while loading.
 */

import { SkeletonBlock, SkeletonCircle, SkeletonLine } from '@/src/components/ui/skeleton'

// ─── Skeleton vendor card — mirrors VendorCard exactly ────────────────────────

function SkeletonVendorCard() {
  return (
    <div className="bg-bg-card rounded-xl md:rounded-2xl border border-white/5 overflow-hidden flex flex-col h-full">
      {/* Square image area — mirrors aspect-square gradient hero */}
      <SkeletonBlock className="w-full aspect-square rounded-none bg-[#252525]" />

      {/* Info section — mirrors p-3 md:p-5 flex flex-col flex-1 */}
      <div className="p-3 md:p-5 flex flex-col flex-1 gap-2">
        {/* Vendor name — font-bebas text-base md:text-xl min-h-[2rem] md:min-h-[3rem] */}
        <SkeletonLine className="h-5 md:h-6 w-4/5" />
        <SkeletonLine className="h-5 md:h-6 w-3/5" />

        {/* Description — 2 lines, text-[0.6875rem] md:text-sm min-h-[2rem] */}
        <div className="flex flex-col gap-1.5 mt-1">
          <SkeletonLine className="h-3 w-full" />
          <SkeletonLine className="h-3 w-4/5" />
        </div>

        {/* Cuisine / booth meta — text-[0.625rem] md:text-xs */}
        <SkeletonLine className="h-3 w-2/5 mt-1" />

        {/* CTA button — mt-auto py-2 md:py-2.5 rounded-lg md:rounded-xl */}
        <SkeletonBlock className="mt-auto h-8 md:h-10 w-full rounded-lg md:rounded-xl" />
      </div>
    </div>
  )
}

// ─── Loading screen ────────────────────────────────────────────────────────────

export default function VendorsLoading() {
  return (
    <>
      <span className="sr-only">Loading vendors…</span>

      <div className="pt-20 min-h-screen" aria-hidden="true">

        {/* ── Header — mirrors bg-[radial-gradient...#1a1a1a] py-[3.75rem] pb-10 ── */}
        <div className="bg-bg-card py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
          <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 animate-pulse">
            {/* Title — font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center */}
            <div className="flex flex-col items-center gap-3 mb-10">
              <SkeletonBlock className="h-10 md:h-14 w-48 md:w-72 rounded-lg" />
              {/* Subtitle — text-text-gray text-lg */}
              <SkeletonLine className="h-4 w-64 md:w-80" />
            </div>

            {/* Search bar — max-w-[37.5rem] rounded-full py-[1.125rem] */}
            <SkeletonBlock className="max-w-[37.5rem] mx-auto h-[3.25rem] rounded-full" />
          </div>
        </div>

        {/* ── Main content ──────────────────────────────────────────────────────── */}
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">

          {/* Filter row — py-5 md:py-[1.875rem] border-b border-white/5 */}
          <div className="py-5 md:py-[1.875rem] border-b border-white/5 animate-pulse">
            {/* "Filter by Vendor" label */}
            <SkeletonLine className="h-3.5 w-32 mb-4" />
            {/* Filter pills — px-6 py-3 rounded-full */}
            <div className="flex flex-wrap gap-3 md:gap-2">
              <SkeletonBlock className="h-10 md:h-9 w-28 rounded-full" />
              <SkeletonBlock className="h-10 md:h-9 w-36 rounded-full" />
              <SkeletonBlock className="h-10 md:h-9 w-32 rounded-full" />
              <SkeletonBlock className="h-10 md:h-9 w-40 rounded-full" />
              <SkeletonBlock className="h-10 md:h-9 w-24 rounded-full" />
            </div>
          </div>

          {/* Grid section — py-10 pb-20 */}
          <div className="py-10 pb-20">
            {/* Section heading row — mb-[1.875rem] pb-5 border-b border-white/5 */}
            <div className="flex justify-between items-center mb-[1.875rem] pb-5 border-b border-white/5 animate-pulse">
              {/* "All Vendors" bebas heading */}
              <SkeletonBlock className="h-8 w-36 rounded-lg" />
              {/* vendor count */}
              <SkeletonLine className="h-3.5 w-16" />
            </div>

            {/* Vendor card grid — grid-cols-2 sm:auto-fill gap-3 sm:gap-6 */}
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 sm:gap-6 animate-pulse">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonVendorCard key={i} />
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
