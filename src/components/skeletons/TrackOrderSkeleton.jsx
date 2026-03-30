// Skeleton for the Track Order page
// Mirrors: large map area + order status stepper + order detail cards
const TrackOrderSkeleton = () => (
  <div className="pt-20 min-h-screen pb-16" aria-hidden="true">
    <span className="sr-only">Loading order tracking...</span>

    <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-8 animate-pulse">

      {/* Page title bar */}
      <div className="h-8 w-40 bg-white/10 rounded-lg mb-6" />

      <div className="grid grid-cols-[1fr_22rem] lg:grid-cols-1 gap-6">

        {/* Left column — map + stepper */}
        <div className="flex flex-col gap-5">

          {/* Map placeholder — large rectangle */}
          <div className="w-full h-[22rem] md:h-64 bg-white/10 rounded-2xl overflow-hidden relative">
            {/* Subtle map grid lines for visual depth */}
            <div className="absolute inset-0 opacity-[0.06]"
              style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
                backgroundSize: "40px 40px"
              }}
            />
            {/* Center pin shape */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-white/10 ring-4 ring-white/5" />
            </div>
          </div>

          {/* Order status stepper — 4 steps */}
          <div className="bg-bg-card border border-white/5 rounded-2xl p-6 md:p-4">
            <div className="h-5 w-32 bg-white/10 rounded-full mb-5" />

            <div className="relative flex items-start gap-0">
              {/* Connector line behind dots */}
              <div className="absolute top-[1.125rem] left-[1.125rem] right-[1.125rem] h-px bg-white/5" />

              {[1, 2, 3, 4].map((step) => (
                <div key={step} className="flex-1 flex flex-col items-center gap-2 relative z-10">
                  {/* Step circle */}
                  <div className={`w-9 h-9 rounded-full flex-shrink-0 ${step === 1 ? "bg-white/20" : "bg-white/5 border border-white/10"}`} />
                  {/* Step label lines */}
                  <div className="h-2.5 bg-white/5 rounded-full w-12 md:w-10" />
                  <div className="h-2 bg-white/5 rounded-full w-8 md:w-6" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column — order detail cards */}
        <div className="flex flex-col gap-4">

          {/* ETA card */}
          <div className="bg-bg-card border border-white/5 rounded-2xl p-5">
            <div className="h-3 w-20 bg-white/5 rounded-full mb-3" />
            <div className="h-8 w-28 bg-white/10 rounded-lg mb-1" />
            <div className="h-3 w-36 bg-white/5 rounded-full" />
          </div>

          {/* Items summary card */}
          <div className="bg-bg-card border border-white/5 rounded-2xl p-5">
            <div className="h-4 w-24 bg-white/10 rounded-full mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-white/10 rounded-full w-3/4" />
                    <div className="h-2.5 bg-white/5 rounded-full w-1/2" />
                  </div>
                  <div className="h-3 w-12 bg-white/5 rounded-full" />
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-white/5 flex justify-between">
              <div className="h-3 w-16 bg-white/5 rounded-full" />
              <div className="h-4 w-16 bg-white/10 rounded-full" />
            </div>
          </div>

          {/* Delivery address card */}
          <div className="bg-bg-card border border-white/5 rounded-2xl p-5">
            <div className="h-4 w-32 bg-white/10 rounded-full mb-4" />
            <div className="flex gap-3">
              <div className="w-9 h-9 bg-white/10 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-white/10 rounded-full w-4/5" />
                <div className="h-3 bg-white/5 rounded-full w-3/5" />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
);

export default TrackOrderSkeleton;
