import { Link } from "react-router-dom";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";

const LandingNavbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 w-full px-8 lg:px-10 md:px-5 py-4 flex justify-between items-center bg-bg-dark/95 backdrop-blur-sm z-[100] border-b border-white/10">
      <Link to="/" className="flex items-center gap-2 no-underline">
        <img
          src="/images/logo/fairdash-icon.png"
          alt="FairDash"
          className="w-9 h-9 xs:w-7 xs:h-7 object-contain"
        />
        <span className="font-bebas text-[2rem] xs:text-[1.5rem] tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
          FAIR<span className="text-neon-pink">DASH</span>
        </span>
      </Link>

      {/* Both buttons — shown on xs (480px+) and up */}
      <div className="hidden xs:flex items-center gap-3">
        <SignInButton mode="modal" forceRedirectUrl="/home">
          <button className="px-5 py-2.5 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide hover:bg-neon-pink hover:text-white hover:shadow-glow-intense">
            Sign In
          </button>
        </SignInButton>
        <SignUpButton mode="modal" forceRedirectUrl="/home">
          <button className="px-5 py-2.5 bg-neon-pink border-2 border-neon-pink text-white font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.875rem] tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense">
            Sign Up
          </button>
        </SignUpButton>
      </div>

      {/* Sign Up only — shown on screens smaller than xs (< 480px) */}
      <SignUpButton mode="modal" forceRedirectUrl="/home">
        <button className="xs:hidden px-4 py-2 bg-neon-pink border-0 text-white font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-[0.75rem] tracking-wide hover:bg-[#e0006b]">
          Sign Up
        </button>
      </SignUpButton>
    </nav>
  );
};

export default LandingNavbar;
