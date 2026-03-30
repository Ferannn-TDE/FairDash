// Skeleton for the Location / Address page
// Mirrors: map rectangle (top) + search input + saved address list
const LocationSkeleton = () => (
  <div className="pt-20 min-h-screen pb-16" aria-hidden="true">
    <span className="sr-only">Loading location...</span>

    <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-8 animate-pulse">

      {/* Page title */}
      <div className="h-8 w-44 bg-white/10 rounded-lg mb-6" />

      {/* Map placeholder */}
      <div className="w-full h-64 md:h-48 bg-white/10 rounded-2xl overflow-hidden relative mb-6">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
            backgroundSize: "40px 40px"
          }}
        />
        {/* Center marker */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/10 ring-4 ring-white/5" />
        </div>
      </div>

      {/* Search / address input */}
      <div className="h-12 bg-white/10 rounded-full w-full mb-8" />

      {/* Saved addresses section */}
      <div className="h-4 w-36 bg-white/10 rounded-full mb-4" />

      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-bg-card border border-white/5 rounded-xl p-4 flex items-center gap-4"
          >
            {/* Icon circle */}
            <div className="w-10 h-10 rounded-xl bg-white/10 flex-shrink-0" />

            {/* Text lines */}
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-white/10 rounded-full w-2/5" />
              <div className="h-3 bg-white/5 rounded-full w-3/4" />
            </div>

            {/* Action chevron */}
            <div className="w-5 h-5 bg-white/5 rounded-full flex-shrink-0" />
          </div>
        ))}
      </div>

    </div>
  </div>
);

export default LocationSkeleton;
