import { useState, useEffect } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import FoodCard from "../components/FoodCard";
import VendorDetailSkeleton from "../components/skeletons/VendorDetailSkeleton";

const VendorDetail = () => {
  const { vendorId } = useParams();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!vendorId) return;
    setLoading(true);
    fetch(`/api/vendors/${vendorId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setNotFound(true);
        } else {
          setVendor(data.data ?? data);
        }
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [vendorId]);

  if (loading) {
    return <VendorDetailSkeleton />;
  }

  if (notFound) return <Navigate to="/vendors" />;

  // Normalise menu items into the shape FoodCard expects
  const items = (vendor?.menuItems ?? []).map(item => ({
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    price: item.price,
    imageUrl: item.imageUrl ?? null,
    image: item.imageUrl ?? null,
    category: item.category,
    vendorId: vendor.id,
    eventId: vendor.eventId,
    vendorName: vendor.name,
    prepTime: item.prepTime,
  }));

  const itemCount = items.length;

  return (
    <div className="pt-20 min-h-screen">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-12 md:py-8 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <Link
            to="/vendors"
            className="inline-flex items-center gap-2 text-text-gray text-sm font-medium no-underline hover:text-neon-pink transition-colors duration-200 mb-6"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Vendors
          </Link>

          <div className="flex items-center gap-5 md:flex-col md:items-start">
            <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-[2.5rem] overflow-hidden flex-shrink-0">
              {vendor?.logoUrl
                ? <img src={vendor.logoUrl} alt={vendor.name} className="w-full h-full object-cover" />
                : '🍽️'
              }
            </div>

            <div className="flex-1">
              <h1 className="font-bebas text-[clamp(2rem,5vw,3.5rem)] leading-tight tracking-[0.125rem] mb-1">
                {vendor?.name}
              </h1>
              {vendor?.description && (
                <p className="text-text-gray text-base mb-3">{vendor.description}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-text-gray flex-wrap">
                <span>{vendor?.cuisineType}</span>
                {vendor?.boothNumber && (
                  <>
                    <span className="w-1 h-1 bg-text-gray rounded-full" />
                    <span>Booth {vendor.boothNumber}</span>
                  </>
                )}
                <span className="w-1 h-1 bg-text-gray rounded-full" />
                <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
                {vendor?.isBusy && (
                  <>
                    <span className="w-1 h-1 bg-text-gray rounded-full" />
                    <span className="text-yellow-400">Temporarily busy</span>
                  </>
                )}
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
            <p className="text-text-gray">This vendor hasn't added any items to their menu.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {items.map(item => (
              <FoodCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorDetail;
