// Mirrors FoodCard layout exactly — aspect-square image + content section
const FoodCardSkeleton = () => (
  <div className="animate-pulse bg-bg-card rounded-xl md:rounded-2xl overflow-hidden border border-white/5 flex flex-col h-full">
    {/* Image — matches aspect-square */}
    <div className="w-full aspect-square bg-white/10 flex-shrink-0" />

    {/* Content — matches p-3 md:p-5 */}
    <div className="p-3 md:p-5 flex flex-col flex-1">
      {/* Name + Price row — min-h-[2.5rem] md:min-h-[3rem] */}
      <div className="flex items-start justify-between gap-1.5 mb-2">
        <div className="flex-1 space-y-1.5">
          <div className="h-4 md:h-5 bg-white/10 rounded-full w-3/4" />
          <div className="h-3 md:h-4 bg-white/5 rounded-full w-1/2" />
        </div>
        {/* Price */}
        <div className="h-5 md:h-6 bg-white/10 rounded-full w-12 flex-shrink-0" />
      </div>

      {/* Description — min-h-[2rem] md:min-h-[2.5rem] */}
      <div className="space-y-1.5 mb-2 md:mb-3">
        <div className="h-3 bg-white/5 rounded-full w-full" />
        <div className="h-3 bg-white/5 rounded-full w-5/6" />
      </div>

      {/* Add to Cart button */}
      <div className="mt-auto h-8 md:h-11 bg-white/5 border border-white/10 rounded-lg md:rounded-xl w-full" />
    </div>
  </div>
);

export default FoodCardSkeleton;
