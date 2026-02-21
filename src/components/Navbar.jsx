import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bars3Icon,
  ShoppingBagIcon,
  ChevronDownIcon,
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { useCart } from "../context/CartContext";
import { useUser, useClerk, SignInButton } from "@clerk/clerk-react";
import { useMobileMenu } from "../context/MobileMenuContext";
import SignOutModal from "./SignOutModal";

const navLinkClass =
  "text-text-gray no-underline font-medium transition-all duration-300 uppercase text-[0.875rem] tracking-wide relative after:content-[''] after:absolute after:-bottom-[5px] after:left-0 after:w-0 after:h-0.5 after:bg-neon-pink after:transition-all after:duration-300 hover:text-neon-pink hover:after:w-full";

const Navbar = () => {
  const { getCartCount, setIsCartOpen } = useCart();
  const { setIsMobileMenuOpen } = useMobileMenu();
  const cartCount = getCartCount();
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = () => {
    signOut(() => {
      toast.success("Signed out successfully. See you soon! 👋");
      navigate("/");
    });
  };

  return (
    <>
      <nav className="fixed top-0 w-full bg-bg-dark/90 backdrop-blur-md border-b border-white/10 z-50">
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

            {/* Desktop nav links — tablet+ */}
            <div className="hidden tablet:flex items-center gap-6">
              <Link to="/menu" className={navLinkClass}>Menu</Link>
              <Link to="/vendors" className={navLinkClass}>Vendors</Link>
              <Link to="/track" className={navLinkClass}>Track Order</Link>
              <Link to="/location" className={navLinkClass}>Location</Link>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">

              {/* Avatar dropdown — tablet+, signed in */}
              {isSignedIn ? (
                <div className="hidden tablet:block relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen((o) => !o)}
                    className="flex items-center gap-2 p-1.5 pr-3 hover:bg-white/5 rounded-xl transition-all duration-200 group bg-transparent border-0 cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-neon-pink via-neon-pink to-[#cc0060] flex items-center justify-center shadow-lg ring-2 ring-white/10 group-hover:ring-neon-pink/30 transition-all flex-shrink-0">
                      <span className="text-white text-sm font-bold">
                        {(user?.firstName?.[0] || "U").toUpperCase()}
                      </span>
                    </div>
                    <ChevronDownIcon
                      className={`w-4 h-4 text-text-gray group-hover:text-neon-pink transition-all duration-200 ${
                        isDropdownOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-bg-card border border-white/10 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden animate-fadeIn z-10">
                      {/* User info */}
                      <div className="px-4 py-3 border-b border-white/10">
                        <p className="text-white font-semibold text-sm truncate">
                          {user?.firstName
                            ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
                            : "User"}
                        </p>
                        <p className="text-text-gray text-xs truncate">
                          {user?.emailAddresses?.[0]?.emailAddress || ""}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="py-2">
                        <Link
                          to="/account"
                          onClick={() => setIsDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-white hover:bg-white/5 transition-colors no-underline text-sm"
                        >
                          <UserCircleIcon className="w-5 h-5 text-text-gray flex-shrink-0" />
                          Manage Account
                        </Link>
                        <button
                          onClick={() => {
                            setIsDropdownOpen(false);
                            setShowSignOutModal(true);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-text-gray hover:text-red-400 hover:bg-red-400/5 transition-colors bg-transparent border-0 cursor-pointer text-sm"
                        >
                          <ArrowRightOnRectangleIcon className="w-5 h-5 flex-shrink-0" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <SignInButton mode="modal" forceRedirectUrl="/home">
                  <button className="hidden tablet:block px-7 py-2.5 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide shadow-glow hover:bg-neon-pink hover:text-white hover:shadow-glow-intense">
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

              {/* Hamburger — below tablet only */}
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="tablet:hidden p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
                aria-label="Open menu"
              >
                <Bars3Icon className="w-6 h-6 text-neon-pink" />
              </button>
            </div>

          </div>
        </div>
      </nav>

      <SignOutModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleSignOut}
      />
    </>
  );
};

export default Navbar;
