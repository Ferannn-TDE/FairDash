import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeftIcon, ClockIcon } from "@heroicons/react/24/outline";
import { getVendorById, getItemsByVendor } from "../utils/vendorData";
import FoodCard from "../components/FoodCard";

const VendorDetail = () => {
  const { vendorId } = useParams();
  const vendor = getVendorById(vendorId);

  if (!vendor) {
    return <Navigate to="/vendors" />;
  }

  const items = getItemsByVendor(vendorId);

  return (
    <div className="pt-20 min-h-screen">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-12 md:py-8 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          {/* Back button */}
          <Link
            to="/vendors"
            className="inline-flex items-center gap-2 text-text-gray text-sm font-medium no-underline hover:text-neon-pink transition-colors duration-200 mb-6"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Vendors
          </Link>

          <div className="flex items-center gap-5 md:flex-col md:items-start">
            {/* Vendor emoji */}
            <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-[2.5rem] flex-shrink-0">
              {vendor.emoji}
            </div>

            <div className="flex-1">
              <h1 className="font-bebas text-[clamp(2rem,5vw,3.5rem)] leading-tight tracking-[0.125rem] mb-1">
                {vendor.name}
              </h1>
              <p className="text-text-gray text-base mb-3">
                {vendor.description}
              </p>
              <div className="flex items-center gap-4 text-sm text-text-gray flex-wrap">
                <span className="text-yellow-400">⭐ {vendor.rating}</span>
                <span className="w-1 h-1 bg-text-gray rounded-full" />
                <span className="flex items-center gap-1.5">
                  <ClockIcon className="w-4 h-4" />
                  {vendor.deliveryTime}
                </span>
                <span className="w-1 h-1 bg-text-gray rounded-full" />
                <span>{vendor.priceRange}</span>
                <span className="w-1 h-1 bg-text-gray rounded-full" />
                <span>
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Items Grid */}
      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-10 pb-20">
        <h2 className="font-bebas text-[2rem] tracking-wide mb-8">Menu</h2>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-[5rem] mb-4 opacity-30">🍽️</div>
            <h3 className="font-bebas text-2xl mb-2">No items yet</h3>
            <p className="text-text-gray">
              This vendor hasn't added any items to their menu.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 xs:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 xs:gap-6">
            {items.map((item) => (
              <FoodCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorDetail;
