function FoodCardSkeleton() {
  return (
    <div className="animate-pulse bg-[#1A1A1A] rounded-xl overflow-hidden border border-white/5 flex flex-col h-full">
      <div className="w-full aspect-[4/3] bg-white/10 flex-shrink-0" />
      <div className="p-3 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-1.5 mb-2">
          <div className="flex-1 space-y-1.5">
            <div className="h-4 bg-white/10 rounded-full w-3/4" />
            <div className="h-3 bg-white/5 rounded-full w-1/2" />
          </div>
          <div className="h-5 bg-white/10 rounded-full w-12 flex-shrink-0" />
        </div>
        <div className="space-y-1.5 mb-2">
          <div className="h-3 bg-white/5 rounded-full w-full" />
          <div className="h-3 bg-white/5 rounded-full w-5/6" />
        </div>
        <div className="mt-auto h-8 bg-white/5 border border-white/10 rounded-xl w-full" />
      </div>
    </div>
  )
}

function CategorySection({ count }: { count: number }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-3 bg-white/10 rounded-full w-24" />
        <div className="flex-1 h-px bg-white/10" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <FoodCardSkeleton key={i} />
        ))}
      </div>
    </section>
  )
}

export default function VendorDetailLoading() {
  return (
    <div
      className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 animate-pulse"
      aria-hidden="true"
    >
      <span className="sr-only">Loading vendor…</span>

      {/* Breadcrumb */}
      <div className="h-4 w-32 bg-white/10 rounded-full mb-6" />

      {/* Vendor header */}
      <div className="flex items-start gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-white/10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="h-7 sm:h-8 bg-white/10 rounded-lg w-48 mb-2" />
          <div className="h-3 bg-white/5 rounded-full w-36 mb-1.5" />
          <div className="h-3 bg-white/5 rounded-full w-64" />
        </div>
      </div>

      {/* Category sections */}
      <CategorySection count={4} />
      <CategorySection count={4} />
    </div>
  )
}
