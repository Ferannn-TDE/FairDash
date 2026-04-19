// Checkout — skeleton loading screen
// Mirrors the two-column layout: form column (lg:col-span-2) + summary sidebar (lg:col-span-1)

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-white/10 rounded-lg ${className ?? ''}`} />
}

function ShimmerLine({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-white/5 rounded-full ${className ?? ''}`} />
}

function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-6">
      <Shimmer className="h-6 w-40 mb-5" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <ShimmerLine key={i} className="h-10 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function CheckoutLoading() {
  return (
    <div className="min-h-screen pb-12">
      {/* Step header skeleton */}
      <div className="border-b border-white/10 bg-[#0F0F0F]">
        <div className="max-w-[75rem] mx-auto px-5 sm:px-6 py-4 flex items-center gap-4">
          <Shimmer className="w-9 h-9 rounded-lg" />
          <Shimmer className="h-7 w-28" />
        </div>
      </div>

      <div className="max-w-[75rem] mx-auto px-5 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left: form skeletons */}
          <div className="lg:col-span-2 space-y-6">
            {/* Fulfillment type */}
            <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-6">
              <Shimmer className="h-6 w-52 mb-5" />
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="border-2 border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <Shimmer className="w-5 h-5 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <ShimmerLine className="h-3.5 w-28" />
                        <ShimmerLine className="h-3 w-44" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer info */}
            <SectionSkeleton rows={2} />

            {/* CTA button */}
            <Shimmer className="h-14 w-full rounded-xl" />
          </div>

          {/* Right: order summary skeleton */}
          <div className="lg:col-span-1">
            <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-6">
              <Shimmer className="h-6 w-36 mb-5" />

              {/* Item rows */}
              <div className="space-y-3 mb-5">
                {[1, 2].map(i => (
                  <div key={i} className="flex gap-3 pb-3 border-b border-white/5 last:border-0">
                    <Shimmer className="w-14 h-14 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <ShimmerLine className="h-3.5 w-3/4" />
                      <ShimmerLine className="h-3 w-1/2" />
                      <ShimmerLine className="h-3.5 w-20" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Price rows */}
              <div className="space-y-2 pb-4 border-b border-white/10">
                {[1, 2].map(i => (
                  <div key={i} className="flex justify-between">
                    <ShimmerLine className="h-3.5 w-20" />
                    <ShimmerLine className="h-3.5 w-12" />
                  </div>
                ))}
              </div>

              <div className="flex justify-between py-4">
                <ShimmerLine className="h-4 w-16" />
                <Shimmer className="h-7 w-20 rounded-lg" />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
