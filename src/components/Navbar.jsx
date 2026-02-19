import { Link, useNavigate } from "react-router-dom";
import {
  ShoppingCartIcon,
  XMarkIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { FaMapMarkerAlt } from "react-icons/fa";
import { useCart } from "../context/CartContext";
import { useState } from "react";
import { useUser, useClerk, SignInButton } from "@clerk/clerk-react";

const HamburgerIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const navLinkClass =
  "text-text-gray no-underline font-medium transition-all duration-300 uppercase text-[0.875rem] tracking-wide relative after:content-[''] after:absolute after:-bottom-[5px] after:left-0 after:w-0 after:h-0.5 after:bg-neon-pink after:transition-all after:duration-300 hover:text-neon-pink hover:after:w-full";

const Navbar = () => {
  const { getCartCount, setIsCartOpen } = useCart();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const cartCount = getCartCount();
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <nav className="fixed top-0 w-full px-8 lg:px-10 md:px-5 py-4 flex justify-between items-center bg-bg-dark/80 backdrop-blur-md z-[100] border-b border-white/10">
      {/* Logo */}
      <Link
        to="/home"
        className="flex items-center gap-3 no-underline transition-transform duration-300 ease-out hover:scale-105"
      >
        <img
          src="/images/logo/fairdash-icon.png"
          alt="FairDash"
          className="w-9 h-9 object-contain"
        />
        <span className="font-bebas text-[2rem] xs:text-[1.75rem] tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
          FAIR<span className="text-neon-pink">DASH</span>
        </span>
      </Link>

      {/* Desktop nav links */}
      <div className="hidden lg:flex gap-8">
        <Link to="/menu" className={navLinkClass}>Menu</Link>
        <Link to="/vendors" className={navLinkClass}>Vendors</Link>
        <Link to="/track" className={navLinkClass}>Track Order</Link>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-3 lg:gap-4">
        {/* Location — desktop only */}
        <Link
          to="/location"
          className="hidden lg:flex bg-transparent border-0 text-text-gray items-center gap-2 cursor-pointer transition-colors duration-300 text-[0.875rem] font-medium hover:text-neon-pink no-underline"
        >
          <FaMapMarkerAlt className="w-4 h-4" />
          <span>Location</span>
        </Link>

        {/* Cart */}
        <button
          className="bg-transparent border-0 text-white cursor-pointer relative p-2 transition-all duration-300 ease-out hover:text-neon-pink hover:scale-110"
          onClick={() => setIsCartOpen(true)}
        >
          <ShoppingCartIcon className="w-5 h-5" />
          {cartCount > 0 && (
            <span className="absolute top-0 right-0 bg-neon-pink text-white rounded-full w-[18px] h-[18px] flex items-center justify-center text-[0.6875rem] font-bold animate-pulse-custom">
              {cartCount}
            </span>
          )}
        </button>

        {/* Auth — desktop only */}
        {isSignedIn ? (
          <div className="hidden lg:flex items-center gap-3">
            <span className="text-white text-[0.875rem] font-medium">
              {user?.firstName || user?.fullName}
            </span>
            <button
              className="px-4 py-2.5 bg-transparent border-2 border-white/20 text-text-gray font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide hover:border-neon-pink hover:text-neon-pink"
              onClick={() => signOut(() => navigate("/"))}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <SignInButton mode="modal" forceRedirectUrl="/home">
            <button className="hidden lg:block px-7 py-2.5 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide shadow-glow hover:bg-neon-pink hover:text-white hover:shadow-glow-intense">
              Sign In
            </button>
          </SignInButton>
        )}

        {/* Hamburger — mobile only */}
        <button
          className="lg:hidden bg-transparent border-0 cursor-pointer p-2.5 text-neon-pink transition-transform duration-200 hover:scale-110"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {mobileMenuOpen ? (
            <XMarkIcon className="w-6 h-6" />
          ) : (
            <HamburgerIcon />
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-bg-dark/98 backdrop-blur-lg border-t border-white/10 shadow-xl z-50 animate-fadeIn">
          <div className="px-4 py-3">
            <Link
              to="/menu"
              onClick={closeMobileMenu}
              className="flex items-center gap-3 px-4 py-3.5 text-text-gray hover:text-neon-pink hover:bg-white/5 rounded-xl transition-all duration-200 no-underline font-medium text-[0.9375rem]"
            >
              Menu
            </Link>
            <Link
              to="/vendors"
              onClick={closeMobileMenu}
              className="flex items-center gap-3 px-4 py-3.5 text-text-gray hover:text-neon-pink hover:bg-white/5 rounded-xl transition-all duration-200 no-underline font-medium text-[0.9375rem]"
            >
              Vendors
            </Link>
            <Link
              to="/track"
              onClick={closeMobileMenu}
              className="flex items-center gap-3 px-4 py-3.5 text-text-gray hover:text-neon-pink hover:bg-white/5 rounded-xl transition-all duration-200 no-underline font-medium text-[0.9375rem]"
            >
              Track Order
            </Link>
            <Link
              to="/location"
              onClick={closeMobileMenu}
              className="flex items-center gap-3 px-4 py-3.5 text-text-gray hover:text-neon-pink hover:bg-white/5 rounded-xl transition-all duration-200 no-underline font-medium text-[0.9375rem]"
            >
              Location
            </Link>
            {isSignedIn && (
              <button
                onClick={() => {
                  closeMobileMenu();
                  signOut(() => navigate("/"));
                }}
                className="flex items-center gap-3 px-4 py-3.5 w-full text-left text-text-gray hover:text-neon-pink hover:bg-white/5 rounded-xl transition-all duration-200 font-medium text-[0.9375rem] bg-transparent border-0 cursor-pointer mt-1 border-t border-white/5 pt-4"
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
                Sign Out
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
