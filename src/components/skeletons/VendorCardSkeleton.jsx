// Mirrors VendorCard layout exactly — aspect-square image + info section
const VendorCardSkeleton = () => (
  <div className="animate-pulse bg-bg-card rounded-xl md:rounded-2xl border border-white/5 overflow-hidden flex flex-col h-full">
    {/* Image — matches aspect-square */}
    <div className="w-full aspect-square bg-white/10 flex-shrink-0" />

    {/* Info — matches p-3 md:p-5 */}
    <div className="p-3 md:p-5 flex flex-col flex-1">
      {/* Vendor name — min-h-[2rem] md:min-h-[3rem] */}
      <div className="h-5 md:h-6 bg-white/10 rounded-full w-3/4 mb-1.5" />
      <div className="h-4 md:h-5 bg-white/5 rounded-full w-1/2 mb-2 md:mb-3" />

      {/* Description — min-h-[2rem] md:min-h-[2.5rem] */}
      <div className="h-3 bg-white/5 rounded-full w-full mb-1.5" />
      <div className="h-3 bg-white/5 rounded-full w-4/5 mb-2 md:mb-3" />

      {/* Cuisine + booth row */}
      <div className="flex items-center gap-2 mb-3 md:mb-4">
        <div className="h-3 bg-white/5 rounded-full w-16" />
        <div className="h-3 bg-white/5 rounded-full w-12" />
      </div>

      {/* View Menu button */}
      <div className="mt-auto h-8 md:h-10 bg-white/5 border border-white/10 rounded-lg md:rounded-xl w-full" />
    </div>
  </div>
);

export default VendorCardSkeleton;
