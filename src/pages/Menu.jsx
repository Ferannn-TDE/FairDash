import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagnifyingGlassIcon, BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import FoodCard from '../components/FoodCard';
import { menuItems } from '../utils/menuData';
import { vendors } from '../utils/vendorData';

const Menu = () => {
  const [searchParams] = useSearchParams();
  const [selectedVendor, setSelectedVendor] = useState('all');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');

  // Only show vendors that have at least one item
  const activeVendors = useMemo(() => {
    const vendorIdsWithItems = new Set(menuItems.map((item) => item.vendorId));
    return vendors.filter((v) => vendorIdsWithItems.has(v.id));
  }, []);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesVendor = selectedVendor === 'all' || item.vendorId === selectedVendor;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q);
      return matchesVendor && matchesSearch;
    });
  }, [selectedVendor, searchQuery]);

  const activeVendorName = activeVendors.find((v) => v.id === selectedVendor)?.name;

  return (
    <div className="pt-20 min-h-screen pb-16">
      {/* Header */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[0.125rem]">
            <span className="text-neon-pink">Fair</span> Menu
          </h1>
          <p className="text-center text-text-gray text-lg mb-10">
            All your favorite fair foods, delivered fresh in 30 minutes
          </p>

          {/* Search */}
          <div className="max-w-[37.5rem] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search for foods..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-[1.125rem] px-6 pl-14 bg-bg-dark border border-white/10 rounded-full text-white text-base outline-none transition-all duration-300 placeholder:text-text-gray focus:border-neon-pink focus:shadow-glow"
            />
          </div>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
        {/* Vendor Filter */}
        <div className="py-10 md:py-[1.875rem] border-b border-white/5">
          <div className="flex items-center gap-2.5 text-text-gray text-sm uppercase tracking-wide mb-5 font-semibold">
            <BuildingStorefrontIcon className="w-[1.125rem] h-[1.125rem]" />
            <span>Filter by Vendor</span>
          </div>
          <div className="flex gap-3 md:gap-2 flex-wrap">
            <button
              className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${
                selectedVendor === 'all'
                  ? 'bg-neon-pink border-neon-pink text-white shadow-glow'
                  : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 hover:scale-[1.02]'
              }`}
              onClick={() => setSelectedVendor('all')}
            >
              All Vendors
            </button>
            {activeVendors.map((vendor) => (
              <button
                key={vendor.id}
                className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 ${
                  selectedVendor === vendor.id
                    ? 'bg-neon-pink border-neon-pink text-white shadow-glow'
                    : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 hover:scale-[1.02]'
                }`}
                onClick={() => setSelectedVendor(vendor.id)}
              >
                <span className="text-lg">{vendor.emoji}</span>
                {vendor.name}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="py-10 pb-20">
          <div className="flex md:flex-col md:items-start md:gap-2.5 justify-between items-center mb-[1.875rem] pb-5 border-b border-white/5">
            <h2 className="font-bebas text-[2rem] tracking-wide m-0">
              {searchQuery.trim()
                ? `Search results for "${searchQuery}"`
                : activeVendorName || 'All Items'}
            </h2>
            <span className="text-text-gray text-sm font-medium">
              {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {filteredItems.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6.25rem] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-[2rem] mb-2.5 tracking-wide">No items found</h3>
              <p className="text-text-gray text-lg">Try a different vendor or search term</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {filteredItems.map((item) => (
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
