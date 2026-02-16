import { Link } from "react-router-dom";
import {
  ShoppingCartIcon,
  Bars3Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { FaMapMarkerAlt } from "react-icons/fa";
import { useCart } from "../context/CartContext";
import { useState } from "react";
import AuthModal from "./AuthModal";

const Navbar = () => {
  const { getCartCount, setIsCartOpen } = useCart();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const cartCount = getCartCount();

  return (
    <>
      <nav className="fixed top-0 w-full px-10 py-5 flex justify-between items-center bg-bg-dark/80 backdrop-blur-md z-[100] border-b border-white/10 lg:px-10 md:px-5 xs:px-5">
        <Link
          to="/home"
          className="font-bebas text-[32px] xs:text-2xl tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)] flex items-center gap-2.5 no-underline transition-transform duration-300 ease-out hover:scale-105"
        >
          FAIR<span className="text-neon-pink">DASH</span>
        </Link>

        <div
          className={`flex gap-[30px] lg:gap-[30px] lg:flex-row lg:static lg:bg-transparent lg:backdrop-blur-none lg:p-0 lg:w-auto lg:h-auto lg:border-0 ${
            mobileMenuOpen
              ? "fixed top-20 right-0 flex-col bg-bg-dark/[0.98] backdrop-blur-lg p-10 w-[300px] h-[calc(100vh-80px)] border-l border-white/10"
              : "max-lg:fixed max-lg:top-20 max-lg:-right-full max-lg:flex-col max-lg:bg-bg-dark/[0.98] max-lg:backdrop-blur-lg max-lg:p-10 max-lg:w-[300px] max-lg:h-[calc(100vh-80px)] max-lg:border-l max-lg:border-white/10"
          } transition-[right] duration-300`}
        >
          <Link
            to="/menu"
            onClick={() => setMobileMenuOpen(false)}
            className="text-text-gray no-underline font-medium transition-all duration-300 uppercase text-sm tracking-wide relative after:content-[''] after:absolute after:-bottom-[5px] after:left-0 after:w-0 after:h-0.5 after:bg-neon-pink after:transition-all after:duration-300 hover:text-neon-pink hover:after:w-full"
          >
            Menu
          </Link>
          <Link
            to="/vendors"
            onClick={() => setMobileMenuOpen(false)}
            className="text-text-gray no-underline font-medium transition-all duration-300 uppercase text-sm tracking-wide relative after:content-[''] after:absolute after:-bottom-[5px] after:left-0 after:w-0 after:h-0.5 after:bg-neon-pink after:transition-all after:duration-300 hover:text-neon-pink hover:after:w-full"
          >
            Vendors
          </Link>
          <Link
            to="/track"
            onClick={() => setMobileMenuOpen(false)}
            className="text-text-gray no-underline font-medium transition-all duration-300 uppercase text-sm tracking-wide relative after:content-[''] after:absolute after:-bottom-[5px] after:left-0 after:w-0 after:h-0.5 after:bg-neon-pink after:transition-all after:duration-300 hover:text-neon-pink hover:after:w-full"
          >
            Track Order
          </Link>
        </div>

        <div className="flex items-center gap-5">
          <Link
            to="/location"
            className="bg-transparent border-0 text-text-gray flex items-center gap-2 cursor-pointer transition-colors duration-300 text-sm font-medium hover:text-neon-pink no-underline"
          >
            <FaMapMarkerAlt className="w-4 h-4" />
            <span className="hidden lg:inline">Location</span>
          </Link>

          <button
            className="bg-transparent border-0 text-white cursor-pointer relative p-2 transition-all duration-300 ease-out hover:text-neon-pink hover:scale-110"
            onClick={() => setIsCartOpen(true)}
          >
            <ShoppingCartIcon className="w-5 h-5" />
            {cartCount > 0 && (
              <span className="absolute top-0 right-0 bg-neon-pink text-white rounded-full w-[18px] h-[18px] flex items-center justify-center text-[11px] font-bold animate-pulse-custom">
                {cartCount}
              </span>
            )}
          </button>

          <button
            className="lg:block hidden px-[30px] py-3 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-sm tracking-wide shadow-glow hover:bg-neon-pink hover:text-white hover:shadow-glow-intense"
            onClick={() => setAuthOpen(true)}
          >
            Sign In
          </button>

          <button
            className="lg:hidden block bg-transparent border-0 text-white cursor-pointer p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <XMarkIcon className="w-6 h-6" />
            ) : (
              <Bars3Icon className="w-6 h-6" />
            )}
          </button>
        </div>
      </nav>

      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
};

export default Navbar;
