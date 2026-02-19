import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/24/outline';
import FoodCard from '../components/FoodCard';
import { categories, menuItems, getItemsByCategory, searchItems } from '../utils/menuData';

const Menu = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState(menuItems);

  useEffect(() => {
    const categoryParam = searchParams.get('category');
    const searchParam = searchParams.get('search');

    if (categoryParam) {
      setActiveCategory(categoryParam);
    }
    if (searchParam) {
      setSearchQuery(searchParam);
    }
  }, [searchParams]);

  useEffect(() => {
    let items = menuItems;

    // Apply category filter
    if (activeCategory !== 'all') {
      items = getItemsByCategory(activeCategory);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      items = searchItems(searchQuery);
    }

    setFilteredItems(items);
  }, [activeCategory, searchQuery]);

  const handleCategoryChange = (categoryId) => {
    setActiveCategory(categoryId);
    setSearchParams(categoryId === 'all' ? {} : { category: categoryId });
    setSearchQuery('');
  };

  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query.trim()) {
      setSearchParams({ search: query });
      setActiveCategory('all');
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="pt-20 min-h-screen">
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 md:px-5 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[2px]">
            <span className="text-neon-pink">Fair</span> Menu
          </h1>
          <p className="text-center text-text-gray text-lg mb-10">
            All your favorite fair foods, delivered fresh in 30 minutes
          </p>

          <div className="max-w-[600px] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search for foods..."
              value={searchQuery}
              onChange={handleSearch}
              className="w-full py-[1.125rem] px-6 pl-14 bg-bg-dark border border-white/10 rounded-full text-white text-base outline-none transition-all duration-300 placeholder:text-text-gray focus:border-neon-pink focus:shadow-glow"
            />
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-[6%] md:px-5">
        <div className="py-10 md:py-[1.875rem] border-b border-white/5">
          <div className="flex items-center gap-2.5 text-text-gray text-sm uppercase tracking-wide mb-5 font-semibold">
            <FunnelIcon className="w-[18px] h-[18px]" />
            <span>Filter by Category</span>
          </div>
          <div className="flex gap-3 md:gap-2 flex-wrap">
            <button
              className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 capitalize ${
                activeCategory === 'all'
                  ? 'bg-neon-pink border-neon-pink text-white shadow-glow'
                  : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 hover:scale-[1.02]'
              }`}
              onClick={() => handleCategoryChange('all')}
            >
              All Items
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`px-6 py-3 md:px-[1.125rem] md:py-2.5 md:text-[0.8125rem] border rounded-full font-medium text-sm cursor-pointer transition-all duration-300 ease-out flex items-center gap-2 capitalize ${
                  activeCategory === cat.id
                    ? 'bg-neon-pink border-neon-pink text-white shadow-glow'
                    : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20 hover:scale-[1.02]'
                }`}
                onClick={() => handleCategoryChange(cat.id)}
              >
                <span className="text-lg">{cat.emoji}</span>
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="py-10 pb-20">
          <div className="flex md:flex-col md:items-start md:gap-2.5 justify-between items-center mb-[1.875rem] pb-5 border-b border-white/5">
            <h2 className="font-bebas text-[2rem] tracking-wide m-0">
              {searchQuery
                ? `Search results for "${searchQuery}"`
                : activeCategory === 'all'
                ? 'All Items'
                : categories.find((c) => c.id === activeCategory)?.name}
            </h2>
            <span className="text-text-gray text-sm font-medium">
              {filteredItems.length} items
            </span>
          </div>

          {filteredItems.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6.25rem] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-[2rem] mb-2.5 tracking-wide">No items found</h3>
              <p className="text-text-gray text-lg">Try adjusting your search or filter</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xs:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 md:gap-[1.875rem]">
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
