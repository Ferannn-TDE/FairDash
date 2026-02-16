import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  MagnifyingGlassIcon,
  ArrowRightIcon,
  PlusIcon,
  MinusIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { useCart } from "../context/CartContext";
import FoodCard from "../components/FoodCard";
import { categories, getPopularItems } from "../utils/menuData";

const sidebarMenu = [
  { label: "Menu", emoji: "🍔", to: "/menu" },
  { label: "Vendors", emoji: "🏪", to: "/vendors" },
  { label: "Favorites", emoji: "❤️", to: "/favorites" },
];

const sidebarOrders = [
  { label: "Track Order", emoji: "📦", to: "/track" },
  { label: "History", emoji: "🕒", to: "/history" },
];

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const Home = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const popularItems = getPopularItems();
  const {
    cart,
    removeFromCart,
    updateQuantity,
    getCartTotal,
    getCartCount,
  } = useCart();

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/menu?search=${encodeURIComponent(searchQuery)}`;
    }
  };

  const cartCount = getCartCount();
  const cartTotal = getCartTotal();
  const deliveryFee = cartCount > 0 ? 2.99 : 0;

  return (
    <div className="flex h-screen overflow-hidden bg-bg-dark">

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ===== LEFT SIDEBAR ===== */}
      <aside
        className={`w-[280px] h-full bg-bg-card border-r border-white/10 flex flex-col p-7 flex-shrink-0 z-50
          max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:h-full max-lg:transition-transform max-lg:duration-300
          ${sidebarOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"}`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 bg-neon-pink rounded-lg flex-shrink-0" />
          <span className="font-bebas text-4xl tracking-[2px] text-white">
            FAIR <span className="text-neon-pink">DASH</span>
          </span>
        </div>

        {/* Menu Section */}
        <div className="text-[11px] uppercase tracking-[1px] text-text-gray font-bold mb-4">
          Menu
        </div>
        {sidebarMenu.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm mb-1 no-underline transition-all duration-200 ${
              location.pathname === item.to
                ? "bg-neon-pink/10 text-neon-pink"
                : "text-text-gray hover:bg-white/5 hover:text-white"
            }`}
          >
            <span>{item.emoji}</span> {item.label}
          </Link>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Orders Section */}
        <div className="text-[11px] uppercase tracking-[1px] text-text-gray font-bold mb-4">
          Orders
        </div>
        {sidebarOrders.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm mb-1 no-underline transition-all duration-200 ${
              location.pathname === item.to
                ? "bg-neon-pink/10 text-neon-pink"
                : "text-text-gray hover:bg-white/5 hover:text-white"
            }`}
          >
            <span>{item.emoji}</span> {item.label}
          </Link>
        ))}

        {/* Free Delivery Promo */}
        <div className="mt-6 p-5 bg-neon-pink/10 rounded-2xl border border-neon-pink/20">
          <div className="font-bold text-neon-pink mb-1">Free Delivery</div>
          <div className="text-xs text-text-gray">On orders over $25</div>
        </div>

        {/* Logout */}
        <button className="flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm mt-4 text-text-gray hover:bg-white/5 hover:text-white transition-all duration-200 bg-transparent border-0 cursor-pointer w-full text-left">
          <ArrowRightOnRectangleIcon className="w-5 h-5" />
          Logout
        </button>
      </aside>

      {/* ===== MAIN SCROLLABLE AREA (center + right) ===== */}
      <div className="flex-1 flex overflow-hidden">

        {/* Center Content Column */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-8 md:p-6 sm:p-5 max-w-[900px]">

            {/* Mobile hamburger */}
            <button
              className="lg:hidden mb-4 p-2 bg-bg-card border border-white/10 rounded-xl text-white"
              onClick={() => setSidebarOpen(true)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Header */}
            <div className="flex justify-between items-center mb-8 sm:flex-col sm:items-start sm:gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-white mb-1">
                  {getGreeting()}, Guest 👋
                </h1>
                <p className="text-text-gray text-sm">
                  Hungry for state fair classics?
                </p>
              </div>
              <div className="bg-bg-card px-4 py-2.5 rounded-full text-sm font-semibold text-white border border-white/10 flex items-center gap-2 whitespace-nowrap">
                📍 Springfield Fairgrounds
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
            <div className="grid grid-cols-2 sm:grid-cols-1 gap-5 mb-10 animate-fadeIn">

              {/* Large Promo Card */}
              <div className="col-span-2 sm:col-span-1 bg-bg-card rounded-3xl p-8 sm:p-6 border border-white/5 relative overflow-hidden transition-all duration-300 hover:border-neon-pink/30 hover:-translate-y-0.5 bg-[radial-gradient(circle_at_top_right,rgba(255,0,119,0.15),transparent_50%)]">
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
                  <form
                    className="bg-white/10 rounded-2xl flex items-center border border-white/10 max-w-[500px] transition-all duration-300 focus-within:border-neon-pink focus-within:shadow-glow"
                    onSubmit={handleSearch}
                  >
                    <input
                      type="text"
                      className="bg-transparent border-0 text-white py-4 px-5 flex-grow text-base outline-none placeholder:text-text-gray min-w-0"
                      placeholder="🔍 Search Corn Dogs, Lemonade..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="bg-neon-pink border-0 m-1.5 w-[44px] h-[44px] rounded-xl text-white cursor-pointer flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-glow flex-shrink-0"
                    >
                      <MagnifyingGlassIcon className="w-5 h-5" />
                    </button>
                  </form>
                </div>
                <div className="absolute -top-20 -right-20 w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(255,0,119,0.12)_0%,transparent_70%)] pointer-events-none" />
              </div>

              {/* Feature Card — 30 Min Delivery */}
              <div className="bg-bg-card rounded-3xl p-7 sm:p-6 border border-neon-pink/20 bg-[linear-gradient(135deg,rgba(255,0,119,0.08),transparent_60%)] transition-all duration-300 hover:border-neon-pink/40 hover:-translate-y-0.5 hover:shadow-glow">
                <div className="text-[40px] mb-3">⚡</div>
                <div className="font-bold text-lg text-neon-pink mb-1">
                  30 Min Delivery
                </div>
                <p className="text-neon-pink/70 text-sm">
                  Guaranteed or it's free.
                </p>
              </div>

              {/* Feature Card — No Entry Fee */}
              <div className="bg-bg-card rounded-3xl p-7 sm:p-6 border border-white/5 transition-all duration-300 hover:border-neon-pink/30 hover:-translate-y-0.5 hover:shadow-glow">
                <div className="text-[40px] mb-3">🎟️</div>
                <div className="font-bold text-lg text-white mb-1">
                  No Entry Fee
                </div>
                <p className="text-text-gray text-sm">
                  Save $15 on fair admission.
                </p>
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
                    className="min-w-[130px] h-[130px] bg-bg-card rounded-2xl flex flex-col items-center justify-center border border-white/5 transition-all duration-300 cursor-pointer no-underline text-white hover:border-neon-pink hover:-translate-y-1 hover:shadow-glow group"
                  >
                    <span className="text-[40px] mb-2.5 transition-transform duration-300 group-hover:scale-125">
                      {cat.emoji}
                    </span>
                    <span className="font-semibold text-xs text-center uppercase tracking-[0.5px]">
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

              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
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
                {[
                  { emoji: "🥨", name: "Auntie Anne's Pretzels", rating: "4.8", time: "15-20 min", price: "$" },
                  { emoji: "🍗", name: "Big Bob's Turkey Legs", rating: "4.9", time: "25-35 min", price: "$$$" },
                  { emoji: "🍦", name: "Dairy Barn Ice Cream", rating: "4.7", time: "10-15 min", price: "$" },
                  { emoji: "🌽", name: "Corndog Kingdom", rating: "4.6", time: "10-20 min", price: "$" },
                  { emoji: "🍋", name: "Fresh Squeeze Lemonade", rating: "4.8", time: "5-10 min", price: "$" },
                ].map((vendor) => (
                  <Link
                    key={vendor.name}
                    to="/menu"
                    className="bg-bg-card p-4 rounded-2xl flex items-center gap-4 border border-white/5 transition-all duration-200 no-underline hover:scale-[1.01] hover:border-neon-pink/30 hover:shadow-glow cursor-pointer"
                  >
                    <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                      {vendor.emoji}
                    </div>
                    <div>
                      <h4 className="text-[15px] font-semibold text-white mb-1">
                        {vendor.name}
                      </h4>
                      <div className="text-xs text-text-gray flex items-center gap-2">
                        <span>⭐ {vendor.rating}</span>
                        <span>•</span>
                        <span>{vendor.time}</span>
                        <span>•</span>
                        <span>{vendor.price}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Footer inside scrollable area */}
            <footer className="border-t border-white/5 pt-6 pb-4 mt-4">
              <div className="flex justify-between items-center text-text-gray text-xs sm:flex-col sm:gap-3 sm:text-center">
                <p>&copy; 2026 FairDash. All rights reserved.</p>
                <div className="flex gap-4">
                  <Link to="/contact" className="text-text-gray no-underline hover:text-neon-pink transition-colors duration-200">Contact</Link>
                  <Link to="/refund-policy" className="text-text-gray no-underline hover:text-neon-pink transition-colors duration-200">Refund Policy</Link>
                </div>
              </div>
            </footer>

          </div>
        </div>

        {/* ===== RIGHT WIDGET COLUMN ===== */}
        <div className="w-[380px] flex-shrink-0 border-l border-white/10 flex flex-col overflow-y-auto max-lg:hidden">
          <div className="p-6 flex flex-col gap-6 flex-1">

            {/* Map Widget */}
            <div className="h-[200px] bg-bg-card rounded-3xl border border-white/5 relative overflow-hidden flex items-center justify-center flex-shrink-0">
              <span className="text-text-gray font-semibold text-sm">
                [ Interactive Map ]
              </span>
              <div className="absolute bottom-4 left-4 bg-bg-dark px-3 py-2 rounded-xl text-xs font-bold text-white border border-white/10">
                2 Drivers Nearby
              </div>
            </div>

            {/* Recent Order Preview */}
            <div className="bg-bg-card rounded-2xl border border-white/5 p-4 flex-shrink-0">
              <div className="text-xs uppercase tracking-wide text-text-gray font-bold mb-3">
                Last Order
              </div>
              <div className="flex items-center gap-3">
                <div className="text-2xl">🌭</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">Footlong Corn Dog x2</div>
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
            <div className="bg-bg-card rounded-3xl border border-white/5 p-6 flex flex-col flex-1 min-h-0">
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
                  <div className="text-[40px] mb-3">🛒</div>
                  <span className="text-sm mb-1">Your cart is empty</span>
                  <span className="text-xs text-text-gray/60">Add items from the menu</span>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto -mx-2 px-2 mb-4">
                  {cart.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-xl mb-2 bg-white/5 border border-white/5 hover:border-neon-pink/20 transition-colors duration-200"
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
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        >
                          <MinusIcon className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-bold min-w-[16px] text-center text-white">
                          {item.quantity}
                        </span>
                        <button
                          className="bg-transparent border-0 text-white cursor-pointer p-0.5 flex items-center justify-center transition-colors duration-200 hover:text-neon-pink"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
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
                >
                  {cartCount > 0
                    ? `Checkout • $${(cartTotal + deliveryFee).toFixed(2)}`
                    : "Checkout ($0.00)"}
                </button>
                {cartCount > 0 && (
                  <p className="text-center mt-2.5 text-text-gray text-[11px]">
                    ⚡ 30-minute delivery guarantee
                  </p>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default Home;
