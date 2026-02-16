import { Link } from "react-router-dom";

const LandingNavbar = ({ onSignIn, onSignUp }) => {
  return (
    <nav className="fixed top-0 w-full px-10 py-5 flex justify-between items-center bg-bg-dark/80 backdrop-blur-md z-[100] border-b border-white/10 md:px-5">
      <Link
        to="/"
        className="font-bebas text-[32px] xs:text-2xl tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)] flex items-center gap-2.5 no-underline transition-transform duration-300 ease-out hover:scale-105"
      >
        FAIR<span className="text-neon-pink">DASH</span>
      </Link>

      <div className="flex items-center gap-3">
        <button
          className="px-6 py-2.5 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-sm tracking-wide hover:bg-neon-pink hover:text-white hover:shadow-glow-intense"
          onClick={onSignIn}
        >
          Sign In
        </button>
        <button
          className="px-6 py-2.5 bg-neon-pink border-2 border-neon-pink text-white font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-lg text-sm tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense"
          onClick={onSignUp}
        >
          Sign Up
        </button>
      </div>
    </nav>
  );
};

export default LandingNavbar;
