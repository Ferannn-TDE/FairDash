export default function OrderTrackingLoading() {
  return (
    <div
      className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 animate-pulse"
      aria-hidden="true"
    >
      <span className="sr-only">Loading order tracking…</span>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-white/10 rounded" />
          <div className="h-4 w-64 bg-white/5 rounded" />
        </div>
        <div className="h-7 w-24 bg-white/10 rounded-full" />
      </div>

      {/* Stepper */}
      <div className="bg-white/[0.03] rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2 flex-1">
              <div className="w-10 h-10 rounded-full bg-white/10" />
              <div className="h-3 w-16 bg-white/5 rounded hidden sm:block" />
            </div>
          ))}
        </div>
      </div>

      {/* Status banner */}
      <div className="h-12 bg-white/[0.03] rounded-xl mb-4" />

      {/* Main layout: stack on mobile, row on lg */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left: map + items + action buttons */}
        <div className="flex-1 space-y-4">
          <div className="h-48 sm:h-64 bg-white/[0.03] rounded-2xl" />

          <div className="bg-white/[0.03] rounded-2xl p-4 space-y-3">
            <div className="h-4 w-32 bg-white/10 rounded" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-white/10 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-40 bg-white/10 rounded" />
                  <div className="h-3 w-20 bg-white/5 rounded" />
                </div>
                <div className="h-4 w-12 bg-white/10 rounded" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="h-12 bg-white/[0.03] rounded-xl" />
            <div className="h-12 bg-white/[0.03] rounded-xl" />
          </div>
        </div>

        {/* Right: meta card */}
        <div className="lg:w-72 bg-white/[0.03] rounded-2xl p-4 space-y-4 h-fit">
          <div className="h-4 w-24 bg-white/10 rounded" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-16 bg-white/5 rounded" />
              <div className="h-4 w-32 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
