// Vendor list — skeleton loading screen
// Mirrors the layout of the vendors page:
//   - Radial-gradient header with title, subtitle, search bar
//   - Filter pills row
//   - Section heading + count row
//   - 6 vendor cards in auto-fill grid

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`bg-white/10 rounded-lg ${className ?? ''}`} />
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={`bg-white/5 rounded-full ${className ?? ''}`} />
}

function SkeletonVendorCard() {
  return (
    <div className="bg-[#1A1A1A] rounded-xl md:rounded-2xl border border-white/5 overflow-hidden flex flex-col h-full">
      <div className="w-full aspect-square bg-white/10 flex-shrink-0" />
      <div className="p-3 md:p-5 flex flex-col flex-1 gap-2">
        <SkeletonLine className="h-5 md:h-6 w-4/5" />
        <SkeletonLine className="h-5 md:h-6 w-3/5" />
        <div className="flex flex-col gap-1.5 mt-1">
          <SkeletonLine className="h-3 w-full" />
          <SkeletonLine className="h-3 w-4/5" />
        </div>
        <SkeletonLine className="h-3 w-2/5 mt-1" />
        <SkeletonBlock className="mt-auto h-8 md:h-10 w-full rounded-lg md:rounded-xl" />
      </div>
    </div>
  )
}

export default function VendorsLoading() {
  return (
    <>
      <span className="sr-only">Loading vendors…</span>
      <div className="pt-20 min-h-screen" aria-hidden="true">
        {/* Header */}
        <div className="bg-[#1A1A1A] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
          <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 animate-pulse">
            <div className="flex flex-col items-center gap-3 mb-10">
              <SkeletonBlock className="h-10 md:h-14 w-48 md:w-72" />
              <SkeletonLine className="h-4 w-64 md:w-80" />
            </div>
            <SkeletonBlock className="max-w-[37.5rem] mx-auto h-[3.25rem] rounded-full" />
          </div>
        </div>

        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          {/* Filter row */}
          <div className="py-5 md:py-[1.875rem] border-b border-white/5 animate-pulse">
            <SkeletonLine className="h-3.5 w-32 mb-4" />
            <div className="flex flex-wrap gap-3 md:gap-2">
              {[28, 36, 32, 40, 24].map((w, i) => (
                <SkeletonBlock key={i} className={`h-10 md:h-9 w-${w} rounded-full`} />
              ))}
            </div>
          </div>

          {/* Grid section */}
          <div className="py-10 pb-20">
            <div className="flex justify-between items-center mb-[1.875rem] pb-5 border-b border-white/5 animate-pulse">
              <SkeletonBlock className="h-8 w-36" />
              <SkeletonLine className="h-3.5 w-16" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 sm:gap-5 animate-pulse">
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
