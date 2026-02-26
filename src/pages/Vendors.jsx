import { useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlassIcon, BuildingStorefrontIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  vendors,
  getItemCountByVendor,
} from "../utils/vendorData";

const VendorCard = ({ vendor }) => {
  const itemCount = getItemCountByVendor(vendor.id);

  return (
    <Link
      to={`/vendors/${vendor.id}`}
      className="bg-bg-card rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 hover:border-neon-pink/30 hover:scale-[1.02] hover:shadow-glow no-underline group"
    >
      {/* Emoji hero */}
      <div className="h-[8.75rem] bg-gradient-to-br from-[#252525] to-bg-card flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.08),transparent_70%)]" />
        <span className="text-[4rem] relative z-10 transition-transform duration-300 group-hover:scale-110">
          {vendor.emoji}
        </span>
        <div className="absolute top-3 right-3 bg-black/70 px-2.5 py-1 rounded-full text-[0.6875rem] font-bold text-neon-pink border border-neon-pink/30">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </div>
      </div>

      {/* Info */}
      <div className="p-5">
        <h3 className="font-bebas text-xl tracking-wide text-white mb-1">
          {vendor.name}
        </h3>
        <p className="text-text-gray text-sm leading-relaxed mb-3 line-clamp-2">
          {vendor.description}
        </p>
        <div className="flex items-center gap-3 text-xs text-text-gray">
          <span className="text-yellow-400">⭐ {vendor.rating}</span>
          <span>•</span>
          <span>{vendor.deliveryTime}</span>
          <span>•</span>
          <span>{vendor.priceRange}</span>
        </div>
        <div className="mt-4 text-center py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-white uppercase tracking-wide transition-all duration-300 group-hover:bg-neon-pink group-hover:border-neon-pink group-hover:shadow-glow">
          View Menu
        </div>
      </div>
    </Link>
  );
};

const Vendors = () => {
  const [selectedVendor, setSelectedVendor] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const isSearching = searchQuery.trim().length > 0;

  const clearSearch = () => setSearchQuery("");

  let filtered = vendors;

  if (isSearching) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q)
    );
  } else if (selectedVendor !== "all") {
    filtered = filtered.filter((v) => v.id === selectedVendor);
  }

  return (
    <div className="pt-20 min-h-screen">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[0.125rem]">
            <span className="text-neon-pink">Italian Fest</span> Vendors
          </h1>
          <p className="text-center text-text-gray text-lg mb-10">
            Browse all vendors and discover their menus
          </p>

          {/* Search */}
          <div className="max-w-[37.5rem] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-[1.125rem] px-6 pl-14 pr-14 bg-bg-dark border border-white/10 rounded-full text-white text-base outline-none transition-all duration-300 placeholder:text-text-gray focus:border-neon-pink focus:shadow-glow"
            />
            {isSearching && (
              <button
                onClick={clearSearch}
                className="absolute right-5 top-1/2 -translate-y-1/2 p-1 text-text-gray hover:text-white transition-colors bg-transparent border-0 cursor-pointer"
                aria-label="Clear search"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
        {/* Vendor name filters — hidden while searching */}
        {!isSearching && (
          <div className="py-10 md:py-[1.875rem] border-b border-white/5">
            <div className="flex items-center gap-2.5 text-text-gray text-sm uppercase tracking-wide mb-5 font-semibold">
              <BuildingStorefrontIcon className="w-[1.125rem] h-[1.125rem]" />
              <span>Filter by Vendor</span>
            </div>
            <div className="flex gap-3 md:gap-2 flex-wrap">
              <button
                className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${
                  selectedVendor === "all"
                    ? "bg-neon-pink border-neon-pink text-white shadow-glow"
                    : "bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20"
                }`}
                onClick={() => setSelectedVendor("all")}
              >
                <BuildingStorefrontIcon className="w-4 h-4" />
                All Vendors
              </button>

              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${
                    selectedVendor === vendor.id
                      ? "bg-neon-pink border-neon-pink text-white shadow-glow"
                      : "bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20"
                  }`}
                  onClick={() => setSelectedVendor(vendor.id)}
                >
                  <span className="text-base">{vendor.emoji}</span>
                  {vendor.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Vendor Grid */}
        <div className="py-10 pb-20">
          <div className="flex md:flex-col md:items-start md:gap-2.5 justify-between items-center mb-[1.875rem] pb-5 border-b border-white/5">
            <h2 className="font-bebas text-[2rem] tracking-wide">
              {isSearching
                ? `Results for "${searchQuery}"`
                : selectedVendor === "all"
                ? "All Vendors"
                : vendors.find((v) => v.id === selectedVendor)?.name || "Vendors"}
            </h2>
            <div className="flex items-center gap-4">
              <span className="text-text-gray text-sm font-medium">
                {filtered.length} {filtered.length === 1 ? "vendor" : "vendors"}
              </span>
              {isSearching && (
                <button
                  onClick={clearSearch}
                  className="text-neon-pink text-sm font-semibold hover:text-[#e0006b] transition-colors bg-transparent border-0 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6.25rem] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-[2rem] mb-2.5 tracking-wide">
                No vendors found
              </h3>
              <p className="text-text-gray text-lg">
                {isSearching
                  ? `No results for "${searchQuery}"`
                  : "Try selecting a different vendor filter"}
              </p>
              {isSearching && (
                <button
                  onClick={clearSearch}
                  className="mt-6 px-6 py-3 bg-neon-pink text-white rounded-xl font-bold text-sm hover:bg-[#e0006b] transition-colors border-0 cursor-pointer uppercase tracking-wide"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 xs:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 xs:gap-6">
              {filtered.map((vendor) => (
                <VendorCard key={vendor.id} vendor={vendor} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Vendors;
