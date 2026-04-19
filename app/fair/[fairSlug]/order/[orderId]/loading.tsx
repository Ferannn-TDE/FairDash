// Order tracking — skeleton loading screen
// Mirrors: gradient header + full-width stepper + two-column layout (map/items left, meta right)

export default function OrderTrackingLoading() {
  return (
    <div className="min-h-screen pb-16 animate-pulse" aria-hidden="true">
      <span className="sr-only">Loading order tracking…</span>

      {/* Page header skeleton */}
      <div className="bg-[#1a1a1a] py-8 md:py-6 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
          <div className="h-4 w-24 bg-white/10 rounded-full mb-4" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="h-8 w-40 bg-white/10 rounded-lg mb-2" />
              <div className="h-3.5 w-64 bg-white/5 rounded-full" />
            </div>
            <div className="h-7 w-28 bg-white/10 rounded-full" />
          </div>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6">

        {/* Stepper */}
        <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5 mb-4">
          <div className="flex items-start">
            {[1, 2, 3, 4].map((step, idx) => (
              <div key={step} className="flex items-start flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-10 h-10 rounded-full flex-shrink-0 ${step === 1 ? 'bg-white/20' : 'bg-white/5 border border-white/10'}`} />
                  <div className="h-2.5 bg-white/5 rounded-full w-14 mt-2" />
                  <div className="h-2 bg-white/5 rounded-full w-10 mt-1" />
                </div>
                {idx < 3 && (
                  <div className="flex items-center flex-shrink-0 pt-5 w-4">
                    <div className="h-0.5 w-full bg-white/10" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Status banner placeholder */}
        <div className="h-12 bg-amber-500/5 border border-amber-500/10 rounded-xl mb-6" />

        {/* Two-column layout */}
        <div className="grid grid-cols-[1fr_22rem] lg:grid-cols-1 gap-5">

          {/* Left: map + items */}
          <div className="flex flex-col gap-5">
            {/* Map */}
            <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
              <div className="relative w-full h-64 bg-white/5">
                <div className="absolute inset-0 opacity-[0.04]"
                  style={{
                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-white/10 ring-4 ring-white/5" />
                </div>
              </div>
            </div>

            {/* Items card */}
            <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="h-3 w-24 bg-white/10 rounded-full" />
                <div className="h-6 w-28 bg-white/10 rounded-full" />
              </div>
              <div className="px-5 py-3 divide-y divide-white/5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 py-3">
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-white/10 rounded-full w-3/4" />
                      <div className="h-2.5 bg-white/5 rounded-full w-1/2" />
                    </div>
                    <div className="flex-shrink-0 text-right space-y-1">
                      <div className="h-2.5 bg-white/5 rounded-full w-6 ml-auto" />
                      <div className="h-3 bg-white/10 rounded-full w-12" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-4 bg-white/[0.02] border-t border-white/5 space-y-2">
                <div className="flex justify-between">
                  <div className="h-3 bg-white/5 rounded-full w-16" />
                  <div className="h-3 bg-white/5 rounded-full w-12" />
                </div>
                <div className="flex justify-between pt-2 border-t border-white/5">
                  <div className="h-4 bg-white/10 rounded-full w-12" />
                  <div className="h-4 bg-white/10 rounded-full w-16" />
                </div>
              </div>
            </div>
          </div>

          {/* Right: meta card */}
          <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5">
              <div className="h-3 w-24 bg-white/10 rounded-full" />
            </div>
            <div className="px-5 py-4 space-y-5">
              {[40, 52, 36, 64].map((w, i) => (
                <div key={i}>
                  <div className="h-2.5 bg-white/5 rounded-full w-20 mb-2" />
                  <div className={`h-3.5 bg-white/10 rounded-full w-${w}`} style={{ width: `${w * 4}px` }} />
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
