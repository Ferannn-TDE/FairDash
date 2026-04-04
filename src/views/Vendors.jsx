import { useState, useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { MagnifyingGlassIcon, BuildingStorefrontIcon, XMarkIcon, ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { useMediaQuery } from "../hooks/useMediaQuery";
import VendorCardSkeleton from "../components/skeletons/VendorCardSkeleton";

const VendorCard = ({ vendor, eventSlug }) => {
  const itemCount = vendor._count?.menuItems ?? vendor.menuItemCount ?? 0;

  return (
    <Link
      to={`/${eventSlug}/vendors/${vendor.id}`}
      className="bg-bg-card rounded-xl md:rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 hover:border-neon-pink/30 hover:scale-[1.02] hover:shadow-glow no-underline group flex flex-col h-full"
    >
      {/* Image / Emoji hero */}
      <div className="relative w-full aspect-square bg-gradient-to-br from-[#252525] to-bg-card flex items-center justify-center overflow-hidden flex-shrink-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.08),transparent_70%)]" />
        {vendor.logoUrl ? (
          <img src={vendor.logoUrl} alt={vendor.name} className="w-full h-full object-cover relative z-10" />
        ) : (
          <span className="text-[2.5rem] md:text-[4rem] relative z-10 transition-transform duration-300 group-hover:scale-110">
            🍽️
          </span>
        )}
        <div className="absolute top-2 right-2 md:top-3 md:right-3 bg-black/70 px-2 py-0.5 md:px-2.5 md:py-1 rounded-full text-[0.5625rem] md:text-[0.6875rem] font-bold text-neon-pink border border-neon-pink/30">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </div>
        {vendor.isBusy && (
          <div className="absolute top-2 left-2 md:top-3 md:left-3 bg-yellow-500/90 px-2 py-0.5 rounded-full text-[0.5625rem] font-bold text-black">
            Busy
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 md:p-5 flex flex-col flex-1">
        <h3 className="font-bebas text-base md:text-xl tracking-wide text-white mb-1 line-clamp-2 min-h-[2rem] md:min-h-[3rem] leading-tight">
          {vendor.name}
        </h3>
        <p className="text-text-gray text-[0.6875rem] md:text-sm leading-relaxed mb-2 md:mb-3 line-clamp-2 min-h-[2rem] md:min-h-[2.5rem]">
          {vendor.description || vendor.cuisineType}
        </p>
        <div className="flex items-center flex-wrap gap-1.5 md:gap-3 text-[0.625rem] md:text-xs text-text-gray mb-3 md:mb-4">
          <span>{vendor.cuisineType}</span>
          {vendor.boothNumber && (
            <>
              <span className="hidden md:inline">•</span>
              <span>Booth {vendor.boothNumber}</span>
            </>
          )}
        </div>
        <div className="mt-auto text-center py-2 md:py-2.5 rounded-lg md:rounded-xl bg-white/5 border border-white/10 text-[0.625rem] md:text-sm font-semibold text-white uppercase tracking-wide transition-all duration-300 group-hover:bg-neon-pink group-hover:border-neon-pink group-hover:shadow-glow">
          View Menu
        </div>
      </div>
    </Link>
  );
};

const Vendors = () => {
  const { eventSlug } = useParams();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const isMobile = useMediaQuery("(max-width: 48rem)");
  const isSearching = searchQuery.trim().length > 0;
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/vendors?eventSlug=${eventSlug}&limit=100`)
      .then(async r => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}`);
        return json;
      })
      .then(json => {
        setVendors(Array.isArray(json.data) ? json.data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('[Vendors] fetch failed:', err);
        setError(err.message || 'Failed to load vendors');
        setLoading(false);
      });
  }, [eventSlug]);

  const clearSearch = () => setSearchQuery("");

  const filtered = useMemo(() => {
    if (isSearching) {
      const q = searchQuery.toLowerCase();
      return vendors.filter(
        v => v.name.toLowerCase().includes(q) || (v.description || '').toLowerCase().includes(q) || v.cuisineType.toLowerCase().includes(q)
      );
    }
    if (selectedVendor !== "all") {
      return vendors.filter(v => v.id === selectedVendor);
    }
    return vendors;
  }, [vendors, selectedVendor, searchQuery, isSearching]);

  return (
    <div className="pt-20 min-h-screen">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[0.125rem]">
            <span className="text-neon-pink">Fair</span> Vendors
          </h1>
          <p className="text-center text-text-gray text-lg mb-10">
            Browse all vendors and discover their menus
          </p>

          <div className="max-w-[37.5rem] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-[1.125rem] px-6 pl-14 pr-14 bg-bg-dark border border-white/10 rounded-full text-white text-base outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink focus:shadow-glow"
            />
            {isSearching && (
              <button
                onClick={clearSearch}
                className="absolute right-5 top-1/2 -translate-y-1/2 p-1 text-text-gray hover:text-white transition-colors bg-transparent border-0 cursor-pointer"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
        {isSearching && isMobile && (
          <div className="py-5 border-b border-white/5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-white text-sm font-semibold">Results for "{searchQuery}"</p>
              <button onClick={clearSearch} className="text-neon-pink text-sm font-semibold hover:text-[#e0006b] transition-colors bg-transparent border-0 cursor-pointer">Clear</button>
            </div>
            <p className="text-text-gray text-sm">{filtered.length} {filtered.length === 1 ? "vendor" : "vendors"} found</p>
          </div>
        )}

        {!(isSearching && isMobile) && (
          <div className="py-5 md:py-[1.875rem] border-b border-white/5">
            <button
              className="flex items-center justify-between w-full mb-4 bg-transparent border-0 cursor-pointer p-0"
              onClick={() => isMobile && setShowFilters(v => !v)}
            >
              <div className="flex items-center gap-2.5 text-text-gray text-sm uppercase tracking-wide font-semibold">
                <BuildingStorefrontIcon className="w-[1.125rem] h-[1.125rem]" />
                <span>
                  Filter by Vendor
                  {isMobile && selectedVendor !== "all" && (
                    <span className="ml-2 text-neon-pink normal-case">
                      ({vendors.find(v => v.id === selectedVendor)?.name})
                    </span>
                  )}
                </span>
              </div>
              {isMobile && (showFilters ? <ChevronUpIcon className="w-5 h-5 text-text-gray flex-shrink-0" /> : <ChevronDownIcon className="w-5 h-5 text-text-gray flex-shrink-0" />)}
            </button>

            <div className={isMobile && !showFilters ? "hidden" : "flex gap-3 md:gap-2 flex-wrap"}>
              <button
                className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${selectedVendor === "all" ? "bg-neon-pink border-neon-pink text-white shadow-glow active:scale-[0.97]" : "bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 active:scale-[0.97]"}`}
                onClick={() => { setSelectedVendor("all"); if (isMobile) setShowFilters(false); }}
              >
                <BuildingStorefrontIcon className="w-4 h-4" />
                All Vendors
              </button>

              {vendors.map(vendor => (
                <button
                  key={vendor.id}
                  className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${selectedVendor === vendor.id ? "bg-neon-pink border-neon-pink text-white shadow-glow active:scale-[0.97]" : "bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 active:scale-[0.97]"}`}
                  onClick={() => { setSelectedVendor(vendor.id); if (isMobile) setShowFilters(false); }}
                >
                  🍽️ {vendor.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="py-10 pb-20">
          <div className="flex md:flex-col md:items-start md:gap-2.5 justify-between items-center mb-[1.875rem] pb-5 border-b border-white/5">
            <h2 className="font-bebas text-[2rem] tracking-wide">
              {isSearching ? `Results for "${searchQuery}"` : selectedVendor === "all" ? "All Vendors" : vendors.find(v => v.id === selectedVendor)?.name || "Vendors"}
            </h2>
            <div className="flex items-center gap-4">
              <span className="text-text-gray text-sm font-medium">{filtered.length} {filtered.length === 1 ? "vendor" : "vendors"}</span>
              {isSearching && <button onClick={clearSearch} className="text-neon-pink text-sm font-semibold hover:text-[#e0006b] transition-colors bg-transparent border-0 cursor-pointer">Clear</button>}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 sm:gap-6" aria-hidden="true">
              <span className="sr-only">Loading vendors...</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <VendorCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">⚠️</div>
              <p className="text-white font-semibold mb-2">Could not load vendors</p>
              <p className="text-text-gray text-sm">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6.25rem] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-[2rem] mb-2.5 tracking-wide">No vendors found</h3>
              <p className="text-text-gray text-lg">
                {isSearching ? `No results for "${searchQuery}"` : "Check back soon"}
              </p>
              {isSearching && (
                <button onClick={clearSearch} className="mt-6 px-6 py-3 bg-neon-pink text-white rounded-xl font-bold text-sm hover:bg-[#e0006b] transition-colors border-0 cursor-pointer uppercase tracking-wide">
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 sm:gap-6">
              {filtered.map(vendor => (
                <VendorCard key={vendor.id} vendor={vendor} eventSlug={eventSlug} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Vendors;
