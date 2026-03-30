import FoodCardSkeleton from "./FoodCardSkeleton";

// Mirrors VendorDetail full-page layout — header + items grid
const VendorDetailSkeleton = () => (
  <div className="pt-20 min-h-screen" aria-hidden="true">
    <span className="sr-only">Loading vendor...</span>

    {/* Header — matches bg-[radial-gradient...] py-12 md:py-8 border-b border-white/10 */}
    <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.06),transparent_50%),#1a1a1a] py-12 md:py-8 border-b border-white/10">
      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 animate-pulse">
        {/* Back link — h-4 w-32 */}
        <div className="h-4 w-28 bg-white/10 rounded-full mb-6" />

        {/* Vendor identity row — flex gap-5, md:flex-col */}
        <div className="flex items-center gap-5 md:flex-col md:items-start">
          {/* Logo avatar — w-20 h-20 rounded-2xl */}
          <div className="w-20 h-20 bg-white/10 rounded-2xl flex-shrink-0" />

          <div className="flex-1 w-full">
            {/* Vendor name — clamp(2rem,5vw,3.5rem) */}
            <div className="h-10 md:h-8 bg-white/10 rounded-lg w-64 md:w-3/4 mb-2" />
            {/* Description */}
            <div className="h-4 bg-white/5 rounded-full w-80 md:w-full mb-3" />
            {/* Meta row — cuisine · booth · count */}
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

    {/* Items grid — matches py-10 pb-20 */}
    <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-10 pb-20">
      {/* "Menu" heading */}
      <div className="animate-pulse h-8 w-20 bg-white/10 rounded-lg mb-8" />

      {/* grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <FoodCardSkeleton key={i} />
        ))}
      </div>
    </div>
  </div>
);

export default VendorDetailSkeleton;
