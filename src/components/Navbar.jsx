import { Link, useNavigate } from "react-router-dom";
import {
  Bars3Icon,
  ShoppingBagIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { useCart } from "../context/CartContext";
import { useUser, useClerk, SignInButton } from "@clerk/clerk-react";
import { useMobileMenu } from "../context/MobileMenuContext";

const navLinkClass =
  "text-text-gray no-underline font-medium transition-all duration-300 uppercase text-[0.875rem] tracking-wide relative after:content-[''] after:absolute after:-bottom-[5px] after:left-0 after:w-0 after:h-0.5 after:bg-neon-pink after:transition-all after:duration-300 hover:text-neon-pink hover:after:w-full";

const Navbar = () => {
  const { getCartCount, setIsCartOpen } = useCart();
  const { setIsMobileMenuOpen } = useMobileMenu();
  const cartCount = getCartCount();
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  return (
    <nav className="fixed top-0 w-full bg-bg-dark/80 backdrop-blur-md border-b border-white/10 z-50">
      <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-4">
        <div className="flex justify-between items-center">

          {/* Logo */}
          <Link
            to="/home"
            className="flex items-center gap-3 no-underline transition-transform duration-300 ease-out hover:scale-105"
          >
            <img
              src="/images/logo/fairdash-icon.png"
              alt="FairDash"
              className="h-10 md:h-8 w-auto object-contain"
            />
            <span className="font-bebas text-[1.5rem] md:text-[1.25rem] tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
              FAIR<span className="text-neon-pink">DASH</span>
            </span>
          </Link>

          {/* Desktop nav links — show at md+ */}
          <div className="hidden md:flex items-center gap-6">
            <Link to="/menu" className={navLinkClass}>Menu</Link>
            <Link to="/vendors" className={navLinkClass}>Vendors</Link>
            <Link to="/track" className={navLinkClass}>Track Order</Link>
            <Link to="/location" className={navLinkClass}>Location</Link>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Auth — desktop only */}
            {isSignedIn ? (
              <div className="hidden md:flex items-center gap-3">
                <span className="text-white text-[0.875rem] font-medium">
                  {user?.firstName || user?.fullName}
                </span>
                <button
                  className="px-4 py-2.5 bg-transparent border-2 border-white/20 text-text-gray font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide hover:border-neon-pink hover:text-neon-pink flex items-center gap-2"
                  onClick={() => signOut(() => navigate("/"))}
                >
                  <ArrowRightOnRectangleIcon className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            ) : (
              <SignInButton mode="modal" forceRedirectUrl="/home">
                <button className="hidden md:block px-7 py-2.5 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide shadow-glow hover:bg-neon-pink hover:text-white hover:shadow-glow-intense">
                  Sign In
                </button>
              </SignInButton>
            )}

            {/* Cart — always visible */}
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

            {/* Hamburger — mobile only (hidden at md+) */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
              aria-label="Open menu"
            >
              <Bars3Icon className="w-6 h-6 text-neon-pink" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
