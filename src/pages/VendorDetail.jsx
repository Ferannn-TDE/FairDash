import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeftIcon, ClockIcon, PlusIcon } from "@heroicons/react/24/outline";
import { getVendorById, getItemsByVendor, formatPrice } from "../utils/vendorData";
import { useCart } from "../context/CartContext";

const VendorItemCard = ({ item }) => {
  const { addToCart } = useCart();

  return (
    <div className="bg-bg-card rounded-2xl overflow-hidden border border-white/5 transition-all duration-300 hover:border-neon-pink/30 hover:scale-[1.02] hover:shadow-glow animate-fadeIn">
      {/* Image / Emoji area */}
      <div className="h-[160px] bg-gradient-to-br from-[#252525] to-bg-card flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.08),transparent_70%)]" />
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover relative z-10"
          />
        ) : (
          <span className="text-[4rem] relative z-10 animate-float">
            {item.emoji}
          </span>
        )}
        {item.popular && (
          <div className="absolute top-3 left-3 bg-neon-pink px-3 py-1 rounded-full text-xs font-bold z-[2]">
            🔥 Popular
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-5">
        <div className="flex justify-between items-start mb-2 gap-3">
          <h3 className="font-bebas text-xl tracking-wide text-white flex-1">
            {item.name}
          </h3>
          <span className="text-neon-pink font-bold text-lg whitespace-nowrap [text-shadow:0_0_15px_rgba(255,0,119,0.3)]">
            {formatPrice(item)}
          </span>
        </div>
        <p className="text-text-gray text-sm leading-relaxed mb-4">
          {item.description}
        </p>

        {item.tags && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="bg-white/5 text-text-gray px-2.5 py-0.5 rounded-lg text-[0.6875rem] font-medium uppercase tracking-wide border border-white/5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => addToCart(item)}
          className="w-full py-3 bg-white/5 border border-white/10 text-white font-semibold rounded-xl cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 uppercase tracking-wide text-sm hover:bg-neon-pink hover:border-neon-pink hover:shadow-glow"
        >
          <PlusIcon className="w-[18px] h-[18px]" />
          Add to Cart
        </button>
      </div>
    </div>
  );
};

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
        <div className="max-w-[1400px] mx-auto px-[6%] md:px-5">
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
              <h1 className="font-bebas text-[clamp(2rem,5vw,3.5rem)] leading-tight tracking-[2px] mb-1">
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
      <div className="max-w-[1400px] mx-auto px-[6%] md:px-5 py-10 pb-20">
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
          <div className="grid grid-cols-1 xs:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
            {items.map((item) => (
              <VendorItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorDetail;
