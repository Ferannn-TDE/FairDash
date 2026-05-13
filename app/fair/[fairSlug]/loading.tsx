export default function FairLoading() {
  return (
    <div className="min-h-screen bg-bg-dark text-white">
      {/* Hero */}
      <div className="relative h-[260px] sm:h-[340px] md:h-[400px] bg-gradient-to-br from-[#FF0077]/20 to-[#7C3AED]/15 animate-pulse">
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-7 sm:bottom-10 left-5 sm:left-[6%] space-y-2">
          {/* Live badge */}
          <div className="h-5 w-20 bg-white/10 rounded-full" />
          {/* Fair name */}
          <div className="h-10 sm:h-12 w-64 sm:w-80 bg-white/10 rounded" />
          {/* Tagline */}
          <div className="h-4 w-48 bg-white/8 rounded" />
          {/* Meta pills */}
          <div className="flex gap-3 pt-1">
            <div className="h-4 w-20 bg-white/8 rounded" />
            <div className="h-4 w-24 bg-white/8 rounded" />
            <div className="h-4 w-16 bg-white/8 rounded" />
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="bg-bg-dark/90 border-b border-white/5 px-5 sm:px-[6%] lg:px-8 py-3 flex gap-3">
        <div className="h-9 w-36 bg-white/10 rounded-xl animate-pulse" />
        <div className="h-9 w-28 bg-white/8 rounded-xl animate-pulse" />
        <div className="h-9 w-28 bg-white/8 rounded-xl animate-pulse" />
      </div>

      {/* Body */}
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10">
        {/* Section heading */}
        <div className="flex items-center justify-between mb-5">
          <div className="h-7 w-44 bg-white/10 rounded animate-pulse" />
          <div className="h-4 w-20 bg-white/8 rounded animate-pulse" />
        </div>

        {/* Vendor cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-white/5 rounded-2xl overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-white/8" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-white/10 rounded w-3/4" />
                <div className="h-3 bg-white/6 rounded w-1/2" />
                <div className="h-3 bg-white/6 rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
