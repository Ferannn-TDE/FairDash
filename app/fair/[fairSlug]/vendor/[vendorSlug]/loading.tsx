// Vendor detail — skeleton loading screen
// Mirrors the layout of the vendor detail page:
//   - Radial-gradient header with back link, logo, name, meta row
//   - Menu grid (2 cols → 4 cols)

function FoodCardSkeleton() {
  return (
    <div className="animate-pulse bg-[#1A1A1A] rounded-xl md:rounded-2xl overflow-hidden border border-white/5 flex flex-col h-full">
      <div className="w-full aspect-square bg-white/10 flex-shrink-0" />
      <div className="p-3 md:p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-1.5 mb-2">
          <div className="flex-1 space-y-1.5">
            <div className="h-4 md:h-5 bg-white/10 rounded-full w-3/4" />
            <div className="h-3 md:h-4 bg-white/5 rounded-full w-1/2" />
          </div>
          <div className="h-5 md:h-6 bg-white/10 rounded-full w-12 flex-shrink-0" />
        </div>
        <div className="space-y-1.5 mb-2 md:mb-3">
          <div className="h-3 bg-white/5 rounded-full w-full" />
          <div className="h-3 bg-white/5 rounded-full w-5/6" />
        </div>
        <div className="mt-auto h-8 md:h-11 bg-white/5 border border-white/10 rounded-lg md:rounded-xl w-full" />
      </div>
    </div>
  )
}

export default function VendorDetailLoading() {
  return (
    <div className="pt-20 min-h-screen" aria-hidden="true">
      <span className="sr-only">Loading vendor…</span>

      {/* Header */}
      <div className="bg-[#1a1a1a] py-12 md:py-8 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 animate-pulse">
          <div className="h-4 w-28 bg-white/10 rounded-full mb-6" />
          <div className="flex items-center gap-5 md:flex-col md:items-start">
            <div className="w-20 h-20 bg-white/10 rounded-2xl flex-shrink-0" />
            <div className="flex-1 w-full">
              <div className="h-10 md:h-8 bg-white/10 rounded-lg w-64 md:w-3/4 mb-2" />
              <div className="h-4 bg-white/5 rounded-full w-80 md:w-full mb-3" />
              <div className="flex items-center gap-4 flex-wrap">
                <div className="h-3 bg-white/5 rounded-full w-20" />
                <div className="h-3 w-3 bg-white/5 rounded-full" />
                <div className="h-3 bg-white/5 rounded-full w-16" />
                <div className="h-3 w-3 bg-white/5 rounded-full" />
                <div className="h-3 bg-white/5 rounded-full w-12" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Menu grid */}
      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-10 pb-20">
        <div className="animate-pulse h-8 w-20 bg-white/10 rounded-lg mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <FoodCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
