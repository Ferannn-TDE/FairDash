import { Link } from "react-router-dom";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";

const LandingNavbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 w-full px-10 py-5 flex justify-between items-center bg-bg-dark/95 backdrop-blur-sm z-[100] border-b border-white/10 md:px-5">
      <Link
        to="/"
        className="flex items-center gap-3 no-underline"
      >
        <img
          src="/images/logo/fairdash-icon.png"
          alt="FairDash"
          className="w-9 h-9 object-contain"
        />
        <span className="font-bebas text-[32px] xs:text-2xl tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
          FAIR<span className="text-neon-pink">DASH</span>
        </span>
      </Link>

      <div className="flex items-center gap-3">
        <SignInButton mode="modal" forceRedirectUrl="/home">
          <button className="px-6 py-2.5 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-sm tracking-wide hover:bg-neon-pink hover:text-white hover:shadow-glow-intense">
            Sign In
          </button>
        </SignInButton>
        <SignUpButton mode="modal" forceRedirectUrl="/home">
          <button className="px-6 py-2.5 bg-neon-pink border-2 border-neon-pink text-white font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-sm tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense">
            Sign Up
          </button>
        </SignUpButton>
      </div>
    </nav>
  );
};

export default LandingNavbar;
