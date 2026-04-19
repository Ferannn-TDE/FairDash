// Menu page — skeleton loading screen
// Mirrors: gradient header + filter strip + food card grid (2 cols mobile, 4 cols desktop)

function FoodCardSkeleton() {
  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-xl overflow-hidden flex flex-col">
      {/* Image placeholder — aspect-[4/3] */}
      <div className="aspect-[4/3] bg-white/5" />
      {/* Body */}
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3 bg-white/10 rounded-full w-3/4" />
        <div className="h-2.5 bg-white/5 rounded-full w-1/3" />
        <div className="h-4 bg-white/10 rounded-full w-1/2 mt-1" />
        <div className="h-2 bg-white/5 rounded-full w-full mt-1" />
        <div className="h-2 bg-white/5 rounded-full w-4/5" />
        <div className="flex items-center justify-between mt-2">
          <div className="h-2.5 bg-white/5 rounded-full w-8" />
          <div className="h-6 w-14 bg-white/10 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export default function MenuLoading() {
  return (
    <div className="min-h-screen animate-pulse" aria-hidden="true">
      <span className="sr-only">Loading menu…</span>

      {/* Header */}
      <div className="bg-[#1a1a1a] py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 flex flex-col items-center gap-3">
          <div className="h-10 w-64 bg-white/10 rounded-lg" />
          <div className="h-3.5 w-48 bg-white/5 rounded-full" />
          {/* Search bar */}
          <div className="w-full max-w-[37.5rem] h-12 bg-white/5 rounded-full mt-3" />
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
        {/* Filter strip */}
        <div className="py-5 border-b border-white/5 flex gap-2">
          {[80, 112, 96, 104, 88].map((w, i) => (
            <div key={i} className="h-8 bg-white/5 rounded-full flex-shrink-0" style={{ width: `${w}px` }} />
          ))}
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between py-5 pb-4">
          <div className="h-7 w-28 bg-white/10 rounded-lg" />
          <div className="h-4 w-16 bg-white/5 rounded-full" />
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 pb-16">
          {Array.from({ length: 8 }).map((_, i) => (
            <FoodCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
