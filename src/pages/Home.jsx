import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useUser, useClerk } from "@clerk/clerk-react";
import toast from "react-hot-toast";
import { useMobileMenu } from "../context/MobileMenuContext";
import SignOutModal from "../components/SignOutModal";
import {
  MagnifyingGlassIcon,
  ArrowRightIcon,
  PlusIcon,
  MinusIcon,
  ArrowRightOnRectangleIcon,
  Squares2X2Icon,
  BuildingStorefrontIcon,
  HeartIcon,
  TruckIcon,
  ClockIcon,
  Bars3Icon,
  ShoppingBagIcon,
} from "@heroicons/react/24/outline";
import { useCart } from "../context/CartContext";
import FoodCard from "../components/FoodCard";
import { categories, getPopularItems } from "../utils/menuData";
import { vendors as allVendors, searchVendorItems } from "../utils/vendorData";

const sidebarMenu = [
  { label: "Menu", icon: Squares2X2Icon, to: "/menu" },
  { label: "Vendors", icon: BuildingStorefrontIcon, to: "/vendors" },
  { label: "Favorites", icon: HeartIcon, to: "/favorites" },
];

const sidebarOrders = [
  { label: "Track Order", icon: TruckIcon, to: "/track" },
  { label: "History", icon: ClockIcon, to: "/history" },
];

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const Home = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [locationText, setLocationText] = useState("Springfield Fairgrounds");
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const searchRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { setIsMobileMenuOpen } = useMobileMenu();
  const popularItems = getPopularItems();
  const { cart, addToCart, updateQuantity, getCartTotal, getCartCount, setIsCartOpen } =
    useCart();

  // Load saved delivery address
  useEffect(() => {
    const saved = sessionStorage.getItem("deliveryAddress");
    if (saved) setLocationText(saved.split(",")[0].trim());
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSignOut = () => {
    signOut(() => {
      toast.success("Signed out successfully. See you soon! 👋");
      navigate("/");
    });
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
    if (query.trim().length > 0) {
      setSearchResults(searchVendorItems(query));
      setShowSearchResults(true);
    } else {
      setShowSearchResults(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/menu?search=${encodeURIComponent(searchQuery)}`);
      setShowSearchResults(false);
    }
  };

  const handleAddFromSearch = (item) => {
    addToCart(item);
    toast.success(`${item.name} added to cart! 🎉`);
    setShowSearchResults(false);
    setSearchQuery("");
  };

  const cartCount = getCartCount();
  const cartTotal = getCartTotal();
  const deliveryFee = cartCount > 0 ? 2.99 : 0;

  return (
    <>
    <div className="min-h-screen bg-bg-dark desktop:h-screen desktop:overflow-hidden block desktop:grid desktop:grid-cols-[16.25rem_1fr_21.25rem] xl:grid-cols-[17.5rem_1fr_23.75rem]">

      {/* ===== MOBILE STICKY NAV — hidden at desktop+ ===== */}
      <div className="desktop:hidden fixed top-0 left-0 right-0 z-50 bg-bg-dark/80 backdrop-blur-md border-b border-white/10">
        <div className="flex justify-between items-center px-4 py-4">
          <div className="flex items-center gap-2">
            <img
              src="/images/logo/fairdash-icon.png"
              alt="FairDash"
              className="h-8 w-auto object-contain"
            />
            <span className="font-bebas text-[1.25rem] tracking-[0.125rem] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
              FAIR<span className="text-neon-pink">DASH</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
              aria-label="Open cart"
            >
              <ShoppingBagIcon className="w-6 h-6 text-white" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-neon-pink text-white text-[0.6875rem] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
              aria-label="Open menu"
            >
              <Bars3Icon className="w-6 h-6 text-neon-pink" />
            </button>
          </div>
        </div>
      </div>

      {/* ===== LEFT SIDEBAR — desktop only ===== */}
      <aside className="hidden desktop:flex bg-bg-card border-r border-white/10 flex-col p-6 overflow-y-auto h-full z-50">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-12">
          <img
            src="/images/logo/fairdash-icon.png"
            alt="FairDash"
            className="w-10 h-10 object-contain flex-shrink-0"
          />
          <span className="font-bebas text-4xl tracking-[0.125rem] text-white">
            FAIR <span className="text-neon-pink">DASH</span>
          </span>
        </div>

        {/* Menu Section */}
        <div className="text-[0.6875rem] uppercase tracking-[0.0625rem] text-text-gray font-bold mb-4">
          Menu
        </div>
        {sidebarMenu.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm mb-1 no-underline transition-all duration-200 ${
                location.pathname === item.to
                  ? "bg-neon-pink/10 text-neon-pink"
                  : "text-text-gray hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Orders Section */}
        <div className="text-[0.6875rem] uppercase tracking-[0.0625rem] text-text-gray font-bold mb-4">
          Orders
        </div>
        {sidebarOrders.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm mb-1 no-underline transition-all duration-200 ${
                location.pathname === item.to
                  ? "bg-neon-pink/10 text-neon-pink"
                  : "text-text-gray hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}

        {/* Free Delivery Promo */}
        <div className="mt-6 p-5 bg-neon-pink/10 rounded-2xl border border-neon-pink/20">
          <div className="font-bold text-neon-pink mb-1">Free Delivery</div>
          <div className="text-xs text-text-gray">On orders over $25</div>
        </div>

        {/* Logout */}
        <button
          onClick={() => setShowSignOutModal(true)}
          className="flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm mt-4 text-text-gray hover:bg-white/5 hover:text-red-400 transition-all duration-200 bg-transparent border-0 cursor-pointer w-full text-left"
        >
          <ArrowRightOnRectangleIcon className="w-5 h-5" />
          Logout
        </button>
      </aside>

      {/* ===== CENTER CONTENT ===== */}
      <div className="overflow-y-auto desktop:h-full w-full min-w-0">
        {/* Spacer for mobile fixed nav */}
        <div className="h-16 desktop:hidden" />

        <div className="p-6 md:p-4 sm:p-3">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-2xl font-extrabold text-white mb-1">
                {getGreeting()}, {user?.firstName || "Guest"} 👋
              </h1>
              <p className="text-text-gray text-sm">
                Hungry for state fair classics?
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:flex bg-bg-card px-4 py-2.5 rounded-full text-sm font-semibold text-white border border-white/10 items-center gap-2 whitespace-nowrap max-w-[12rem] truncate">
                📍 {locationText}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-3 mb-8 overflow-x-auto pb-1">
            {[
              { label: "Reorder Last", emoji: "🔄", to: "/menu" },
              { label: "Deals", emoji: "🏷️", to: "/menu" },
              { label: "New Items", emoji: "✨", to: "/menu" },
              { label: "Group Order", emoji: "👥", to: "/menu" },
            ].map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="flex items-center gap-2 px-4 py-2.5 bg-bg-card border border-white/5 rounded-xl text-sm font-medium text-text-gray no-underline whitespace-nowrap transition-all duration-200 hover:border-neon-pink/30 hover:text-white"
              >
                <span>{action.emoji}</span> {action.label}
              </Link>
            ))}
          </div>

          {/* ===== BENTO GRID ===== */}
          <div className="flex flex-col gap-5 mb-10 animate-fadeIn">
            {/* Large Promo Card — full width */}
            <div className="bg-bg-card rounded-2xl p-8 sm:p-6 border border-white/5 relative overflow-hidden transition-all duration-300 hover:border-neon-pink/30 hover:-translate-y-0.5 bg-[radial-gradient(circle_at_top_right,rgba(255,0,119,0.15),transparent_50%)]">
              <div className="relative z-[2]">
                <h2 className="font-bebas text-[clamp(2.5rem,4vw,3.5rem)] leading-[1] mb-3">
                  SKIP THE{" "}
                  <span className="text-neon-pink [text-shadow:0_0_20px_rgba(255,0,119,0.4)] animate-neonGlow">
                    LONG LINES
                  </span>
                </h2>
                <p className="text-text-gray text-base sm:text-sm mb-5">
                  Order from your phone. Pick up curbside or get it delivered.
                </p>
                <div className="relative max-w-[31.25rem]" ref={searchRef}>
                  <form
                    className="bg-white/10 rounded-2xl flex items-center border border-white/10 transition-all duration-300 focus-within:border-neon-pink focus-within:shadow-glow"
                    onSubmit={handleSearchSubmit}
                  >
                    <input
                      type="text"
                      className="bg-transparent border-0 text-white py-4 px-5 flex-grow text-base outline-none placeholder:text-text-gray min-w-0"
                      placeholder="🔍 Search Corn Dogs, Lemonade..."
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="bg-neon-pink border-0 m-1.5 w-11 h-11 rounded-xl text-white cursor-pointer flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-glow flex-shrink-0"
                    >
                      <MagnifyingGlassIcon className="w-5 h-5" />
                    </button>
                  </form>

                  {/* Search results dropdown */}
                  {showSearchResults && (
                    <div className="absolute top-full mt-2 w-full bg-bg-card border border-white/10 rounded-2xl max-h-80 overflow-y-auto z-20 shadow-[0_1.25rem_3.75rem_rgba(0,0,0,0.5)]">
                      {searchResults.length > 0 ? (
                        searchResults.slice(0, 6).map((item) => (
                          <button
                            key={item.id}
                            onClick={() => handleAddFromSearch(item)}
                            className="w-full p-3 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0 flex gap-3 items-center text-left bg-transparent border-0"
                          >
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-12 h-12 object-cover rounded-lg flex-shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-bg-dark flex items-center justify-center text-xl flex-shrink-0">
                                {item.emoji}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm truncate">{item.name}</p>
                              <p className="text-neon-pink font-bold text-xs">${item.price?.toFixed(2) ?? `${item.priceMin?.toFixed(2)}+`}</p>
                            </div>
                            <PlusIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                          </button>
                        ))
                      ) : (
                        <p className="p-4 text-text-gray text-center text-sm">No results found</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="absolute -top-20 -right-20 w-[18.75rem] h-[18.75rem] bg-[radial-gradient(circle,rgba(255,0,119,0.12)_0%,transparent_70%)] pointer-events-none" />
            </div>

            {/* Two Feature Cards — ALWAYS side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Feature Card — 30 Min Delivery */}
              <div className="bg-bg-card rounded-2xl p-7 sm:p-6 border border-neon-pink/20 bg-[linear-gradient(135deg,rgba(255,0,119,0.08),transparent_60%)] transition-all duration-300 hover:border-neon-pink/40 hover:-translate-y-0.5 hover:shadow-glow">
                <div className="text-[2.5rem] mb-3">⚡</div>
                <div className="font-bold text-lg text-neon-pink mb-1">
                  30 Min Delivery
                </div>
                <p className="text-neon-pink/70 text-sm">
                  Guaranteed or it's free.
                </p>
              </div>

              {/* Feature Card — No Entry Fee */}
              <div className="bg-bg-card rounded-2xl p-7 sm:p-6 border border-white/5 transition-all duration-300 hover:border-neon-pink/30 hover:-translate-y-0.5 hover:shadow-glow">
                <div className="text-[2.5rem] mb-3">🎟️</div>
                <div className="font-bold text-lg text-white mb-1">
                  No Entry Fee
                </div>
                <p className="text-text-gray text-sm">
                  Save $15 on fair admission.
                </p>
              </div>
            </div>
          </div>

          {/* ===== EXPLORE CATEGORIES ===== */}
          <div className="mb-10">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-bebas text-[1.75rem] tracking-wide">
                Explore the Fairgrounds
              </h2>
              <Link
                to="/menu"
                className="text-neon-pink no-underline font-semibold text-sm uppercase tracking-wide flex items-center gap-2 transition-colors duration-300 hover:opacity-80"
              >
                View All <ArrowRightIcon className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-3">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  to={`/menu?category=${cat.id}`}
                  className="min-w-[8.125rem] h-[8.125rem] bg-bg-card rounded-2xl flex flex-col items-center justify-center border border-white/5 transition-all duration-300 cursor-pointer no-underline text-white hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(255,0,119,0.15)] hover:border-neon-pink/30 hover:bg-white/5 group"
                >
                  <span className="text-[2.5rem] mb-2.5 transition-transform duration-300 group-hover:scale-110">
                    {cat.emoji}
                  </span>
                  <span className="font-semibold text-[0.6875rem] text-center uppercase tracking-[0.03125rem] transition-colors duration-300 group-hover:text-neon-pink">
                    {cat.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* ===== TRENDING NOW ===== */}
          <div className="mb-10">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-bebas text-[1.75rem] tracking-wide">
                🔥 Trending Now
              </h2>
              <Link
                to="/menu"
                className="text-neon-pink no-underline font-semibold text-sm uppercase tracking-wide flex items-center gap-2 transition-colors duration-300 hover:opacity-80"
              >
                View All <ArrowRightIcon className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 xs:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 xs:gap-5">
              {popularItems.map((item) => (
                <FoodCard key={item.id} item={item} />
              ))}
            </div>
          </div>

          {/* ===== POPULAR VENDORS ===== */}
          <div className="mb-10">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-bebas text-[1.75rem] tracking-wide">
                Popular Vendors
              </h2>
              <Link
                to="/vendors"
                className="text-neon-pink no-underline font-semibold text-sm uppercase tracking-wide flex items-center gap-2 transition-colors duration-300 hover:opacity-80"
              >
                View All <ArrowRightIcon className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              {allVendors.slice(0, 5).map((vendor) => (
                <Link
                  key={vendor.id}
                  to={`/vendors/${vendor.id}`}
                  className="bg-bg-card p-4 rounded-2xl flex items-center gap-4 border border-white/5 transition-all duration-200 no-underline hover:scale-[1.01] hover:border-neon-pink/30 hover:shadow-glow cursor-pointer"
                >
                  <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                    {vendor.emoji}
                  </div>
                  <div>
                    <h4 className="text-[0.9375rem] font-semibold text-white mb-1">
                      {vendor.name}
                    </h4>
                    <div className="text-xs text-text-gray flex items-center gap-2">
                      <span>⭐ {vendor.rating}</span>
                      <span>•</span>
                      <span>{vendor.deliveryTime}</span>
                      <span>•</span>
                      <span>{vendor.priceRange}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Footer inside scrollable area */}
          <footer className="border-t border-white/10 pt-8 pb-4 mt-8">
            <div className="mb-6">
              <div className="font-bebas text-[1.5rem] tracking-[0.125rem] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)] mb-1">
                FAIR<span className="text-neon-pink">DASH</span>
              </div>
              <p className="text-text-gray text-xs m-0">The fair comes to your door. Fresh. Fast. Fair.</p>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <h5 className="font-bebas text-[0.875rem] text-neon-pink mb-2">Company</h5>
                <Link to="/contact" className="block text-text-gray text-xs hover:text-neon-pink no-underline mb-1">Contact</Link>
                <Link to="/refund-policy" className="block text-text-gray text-xs hover:text-neon-pink no-underline">Refund Policy</Link>
              </div>
              <div>
                <h5 className="font-bebas text-[0.875rem] text-neon-pink mb-2">Join Us</h5>
                <Link to="/become-vendor" className="block text-text-gray text-xs hover:text-neon-pink no-underline mb-1">Vendor</Link>
                <Link to="/become-driver" className="block text-text-gray text-xs hover:text-neon-pink no-underline">Driver</Link>
              </div>
              <div>
                <h5 className="font-bebas text-[0.875rem] text-neon-pink mb-2">Connect</h5>
                <a href="https://www.facebook.com/fairdash217" target="_blank" rel="noopener noreferrer" className="block text-text-gray text-xs hover:text-neon-pink no-underline mb-1">Facebook</a>
                <a href="mailto:fairdash217@gmail.com" className="block text-text-gray text-xs hover:text-neon-pink no-underline">Email</a>
              </div>
            </div>
            <div className="pt-4 border-t border-white/5 text-text-gray text-xs text-center">
              &copy; 2026 FairDash. All rights reserved.
            </div>
          </footer>
        </div>
      </div>

      {/* ===== RIGHT WIDGET COLUMN ===== */}
      <div className="hidden desktop:flex h-full border-l border-white/10 flex-col overflow-y-auto">
        <div className="p-6 flex flex-col gap-5 flex-1">
          {/* Recent Order Preview */}
          <div className="bg-bg-card rounded-2xl border border-white/5 p-4 flex-shrink-0">
            <div className="text-xs uppercase tracking-wide text-text-gray font-bold mb-3">
              Last Order
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl">🌭</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  Footlong Corn Dog x2
                </div>
                <div className="text-xs text-text-gray">Feb 14 • $15.00</div>
              </div>
              <Link
                to="/menu"
                className="text-xs text-neon-pink font-semibold no-underline hover:opacity-80 whitespace-nowrap"
              >
                Reorder
              </Link>
            </div>
          </div>

          {/* Cart / My Order Widget */}
          <div className="bg-bg-card rounded-2xl border border-white/5 p-5 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">My Order</h3>
              {cartCount > 0 && (
                <span className="bg-neon-pink text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  {cartCount}
                </span>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-text-gray py-8">
                <div className="text-[2.5rem] mb-3">🛒</div>
                <span className="text-sm mb-1">Your cart is empty</span>
                <span className="text-xs text-text-gray/60">
                  Add items from the menu
                </span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto -mx-2 px-2 mb-4">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3.5 rounded-xl mb-2.5 bg-white/5 border border-white/5 hover:border-neon-pink/20 transition-colors duration-200"
                  >
                    <div className="text-2xl flex-shrink-0">{item.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {item.name}
                      </div>
                      <div className="text-xs text-neon-pink font-bold">
                        ${(item.price * item.quantity).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-bg-dark px-2 py-1 rounded-lg flex-shrink-0">
                      <button
                        className="bg-transparent border-0 text-white cursor-pointer p-0.5 flex items-center justify-center transition-colors duration-200 hover:text-neon-pink"
                        onClick={() =>
                          updateQuantity(item.id, item.quantity - 1)
                        }
                      >
                        <MinusIcon className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-bold min-w-4 text-center text-white">
                        {item.quantity}
                      </span>
                      <button
                        className="bg-transparent border-0 text-white cursor-pointer p-0.5 flex items-center justify-center transition-colors duration-200 hover:text-neon-pink"
                        onClick={() =>
                          updateQuantity(item.id, item.quantity + 1)
                        }
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cart Footer */}
            <div className="border-t border-white/10 pt-4 mt-auto">
              {cartCount > 0 && (
                <div className="mb-4 space-y-2 text-sm">
                  <div className="flex justify-between text-text-gray">
                    <span>Subtotal</span>
                    <span>${cartTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-text-gray">
                    <span>Delivery Fee</span>
                    <span>${deliveryFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold pt-2 border-t border-white/5">
                    <span>Total</span>
                    <span>${(cartTotal + deliveryFee).toFixed(2)}</span>
                  </div>
                </div>
              )}
              <button
                className={`w-full py-3.5 rounded-2xl font-bold text-sm cursor-pointer transition-all duration-300 border-0 uppercase tracking-wide ${
                  cartCount > 0
                    ? "bg-neon-pink text-white hover:bg-[#e0006b] hover:shadow-glow-intense"
                    : "bg-white/5 text-text-gray border border-white/10"
                }`}
                disabled={cartCount === 0}
                onClick={() => cartCount > 0 && navigate("/checkout")}
              >
                {cartCount > 0
                  ? `Checkout • $${(cartTotal + deliveryFee).toFixed(2)}`
                  : "Checkout ($0.00)"}
              </button>
              {cartCount > 0 && (
                <p className="text-center mt-2.5 text-text-gray text-[0.6875rem]">
                  ⚡ 30-minute delivery guarantee
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

    <SignOutModal
      isOpen={showSignOutModal}
      onClose={() => setShowSignOutModal(false)}
      onConfirm={handleSignOut}
    />
    </>
  );
};

export default Home;
