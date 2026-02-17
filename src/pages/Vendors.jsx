import { useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlassIcon, FunnelIcon } from "@heroicons/react/24/outline";
import {
  vendors,
  vendorCategories,
  getVendorsByCategory,
  getItemCountByVendor,
  searchVendors,
} from "../utils/vendorData";

const VendorCard = ({ vendor }) => {
  const itemCount = getItemCountByVendor(vendor.id);

  return (
    <Link
      to={`/vendors/${vendor.id}`}
      className="bg-bg-card rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 hover:border-neon-pink/30 hover:scale-[1.02] hover:shadow-glow no-underline group"
    >
      {/* Emoji hero */}
      <div className="h-[140px] bg-gradient-to-br from-[#252525] to-bg-card flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.08),transparent_70%)]" />
        <span className="text-[64px] relative z-10 transition-transform duration-300 group-hover:scale-110">
          {vendor.emoji}
        </span>
        <div className="absolute top-3 right-3 bg-black/70 px-2.5 py-1 rounded-full text-[11px] font-bold text-neon-pink border border-neon-pink/30">
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
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  let filtered = activeCategory === "all"
    ? vendors
    : getVendorsByCategory(activeCategory);

  if (searchQuery.trim()) {
    filtered = searchVendors(searchQuery);
  }

  return (
    <div className="pt-20 min-h-screen">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[60px] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-[8%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[2px]">
            <span className="text-neon-pink">Italian Fest</span> Vendors
          </h1>
          <p className="text-center text-text-gray text-lg mb-10">
            Browse all vendors and discover their menus
          </p>

          {/* Search */}
          <div className="max-w-[600px] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim()) setActiveCategory("all");
              }}
              className="w-full py-[18px] px-6 pl-14 bg-bg-dark border border-white/10 rounded-full text-white text-base outline-none transition-all duration-300 placeholder:text-text-gray focus:border-neon-pink focus:shadow-glow"
            />
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-[8%] md:px-5">
        {/* Category filters */}
        <div className="py-10 md:py-[30px] border-b border-white/5">
          <div className="flex items-center gap-2.5 text-text-gray text-sm uppercase tracking-wide mb-5 font-semibold">
            <FunnelIcon className="w-[18px] h-[18px]" />
            <span>Filter by Category</span>
          </div>
          <div className="flex gap-3 md:gap-2 flex-wrap">
            {vendorCategories.map((cat) => (
              <button
                key={cat.id}
                className={`px-6 py-3 md:px-[18px] md:py-2.5 md:text-[13px] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${
                  activeCategory === cat.id
                    ? "bg-neon-pink border-neon-pink text-white shadow-glow"
                    : "bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20"
                }`}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setSearchQuery("");
                }}
              >
                <span className="text-lg">{cat.emoji}</span>
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Vendor Grid */}
        <div className="py-10 pb-20">
          <div className="flex md:flex-col md:items-start md:gap-2.5 justify-between items-center mb-[30px] pb-5 border-b border-white/5">
            <h2 className="font-bebas text-[2rem] tracking-wide">
              {searchQuery
                ? `Results for "${searchQuery}"`
                : vendorCategories.find((c) => c.id === activeCategory)?.name || "All Vendors"}
            </h2>
            <span className="text-text-gray text-sm font-medium">
              {filtered.length} {filtered.length === 1 ? "vendor" : "vendors"}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[100px] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-[2rem] mb-2.5 tracking-wide">
                No vendors found
              </h3>
              <p className="text-text-gray text-lg">
                Try adjusting your search or filter
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
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
