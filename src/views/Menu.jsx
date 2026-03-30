import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagnifyingGlassIcon, BuildingStorefrontIcon, XMarkIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import FoodCard from '../components/FoodCard';
import { useMediaQuery } from '../hooks/useMediaQuery';
import FoodCardSkeleton from '../components/skeletons/FoodCardSkeleton';

const EVENT_SLUG = 'springfield-fair-2026';

// Normalise DB menu items into the shape FoodCard expects
const normaliseItem = (item) => ({
  id: item.id,
  name: item.name,
  description: item.description ?? '',
  price: item.price,
  imageUrl: item.imageUrl ?? null,
  image: item.imageUrl ?? null,
  category: item.category,
  vendorId: item.vendorId,
  eventId: item.vendor?.eventId ?? null,
  vendorName: item.vendor?.name ?? '',
  prepTime: item.prepTime,
});

const Menu = () => {
  const [searchParams] = useSearchParams();
  const [allItems, setAllItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState('all');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');

  const isMobile = useMediaQuery('(max-width: 48rem)');
  const isSearching = searchQuery.trim().length > 0;
  const clearSearch = () => setSearchQuery('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/menu?eventSlug=${EVENT_SLUG}&limit=100`)
      .then(async r => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}`);
        return json;
      })
      .then(json => {
        const items = (Array.isArray(json.data) ? json.data : []).map(normaliseItem);
        setAllItems(items);
        const vendorMap = new Map();
        items.forEach(item => {
          if (!vendorMap.has(item.vendorId)) {
            vendorMap.set(item.vendorId, { id: item.vendorId, name: item.vendorName });
          }
        });
        setVendors([...vendorMap.values()]);
        setLoading(false);
      })
      .catch(err => {
        console.error('[Menu] fetch failed:', err);
        setError(err.message || 'Failed to load menu');
        setLoading(false);
      });
  }, []);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter(item => {
      if (q) return item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q);
      return selectedVendor === 'all' || item.vendorId === selectedVendor;
    });
  }, [allItems, selectedVendor, searchQuery]);

  const activeVendorName = vendors.find(v => v.id === selectedVendor)?.name;

  return (
    <div className="pt-20 min-h-screen pb-16">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[0.125rem]">
            <span className="text-neon-pink">Fair</span> Menu
          </h1>
          <p className="text-center text-text-gray text-lg mb-10">
            All your favorite fair foods, delivered fresh
          </p>

          <div className="max-w-[37.5rem] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search for foods..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full py-[1.125rem] px-6 pl-14 pr-14 bg-bg-dark border border-white/10 rounded-full text-white text-base outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink focus:shadow-glow"
            />
            {isSearching && (
              <button onClick={clearSearch} className="absolute right-5 top-1/2 -translate-y-1/2 p-1 text-text-gray hover:text-white transition-colors bg-transparent border-0 cursor-pointer">
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
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
                  {isMobile && selectedVendor !== 'all' && (
                    <span className="ml-2 text-neon-pink normal-case">({activeVendorName})</span>
                  )}
                </span>
              </div>
              {isMobile && (showFilters ? <ChevronUpIcon className="w-5 h-5 text-text-gray flex-shrink-0" /> : <ChevronDownIcon className="w-5 h-5 text-text-gray flex-shrink-0" />)}
            </button>

            <div className={isMobile && !showFilters ? 'hidden' : 'flex gap-3 md:gap-2 flex-wrap'}>
              <button
                className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${selectedVendor === 'all' ? 'bg-neon-pink border-neon-pink text-white shadow-glow active:scale-[0.97]' : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 active:scale-[0.97]'}`}
                onClick={() => { setSelectedVendor('all'); if (isMobile) setShowFilters(false); }}
              >
                All Vendors
              </button>
              {vendors.map(vendor => (
                <button
                  key={vendor.id}
                  className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${selectedVendor === vendor.id ? 'bg-neon-pink border-neon-pink text-white shadow-glow active:scale-[0.97]' : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 active:scale-[0.97]'}`}
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
            <h2 className="font-bebas text-[2rem] tracking-wide m-0">
              {isSearching ? `Results for "${searchQuery}"` : activeVendorName || 'All Items'}
            </h2>
            <div className="flex items-center gap-4">
              <span className="text-text-gray text-sm font-medium">{filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}</span>
              {isSearching && <button onClick={clearSearch} className="text-neon-pink text-sm font-semibold hover:text-[#e0006b] transition-colors bg-transparent border-0 cursor-pointer">Clear</button>}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5" aria-hidden="true">
              <span className="sr-only">Loading menu...</span>
              {Array.from({ length: 8 }).map((_, i) => (
                <FoodCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">⚠️</div>
              <p className="text-text-gray">{error}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6.25rem] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-[2rem] mb-2.5 tracking-wide">No items found</h3>
              <p className="text-text-gray text-lg">{isSearching ? `No results for "${searchQuery}"` : 'Try a different vendor or search term'}</p>
              {isSearching && <button onClick={clearSearch} className="mt-6 px-6 py-3 bg-neon-pink text-white rounded-xl font-bold text-sm hover:bg-[#e0006b] transition-colors border-0 cursor-pointer uppercase tracking-wide">Clear Search</button>}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {filteredItems.map(item => (
                <FoodCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Menu;
