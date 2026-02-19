import { useRef, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  MapPinIcon,
  ClockIcon,
  ChevronDownIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { FaFacebookF, FaEnvelope } from "react-icons/fa";
import { useAuth, SignInButton } from "@clerk/clerk-react";
import LandingNavbar from "../components/LandingNavbar";

const Landing = () => {
  const { isSignedIn, isLoaded } = useAuth();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleOption, setScheduleOption] = useState("now");
  const scheduleRef = useRef(null);

  // Close schedule dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (scheduleRef.current && !scheduleRef.current.contains(e.target)) {
        setScheduleOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (isLoaded && isSignedIn) {
    return <Navigate to="/home" />;
  }

  return (
    <div className="min-h-screen bg-bg-dark">
      <LandingNavbar />

      {/* ===== HERO SECTION ===== */}
      <section className="min-h-screen flex items-center pt-20 relative overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(255,0,119,0.15),transparent_40%),linear-gradient(to_bottom,rgba(15,15,15,0.3),#0f0f0f)]">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 w-full">
          <div className="grid grid-cols-1 md:grid-cols-[6fr_4fr] items-center gap-10 min-h-[80vh] lg:min-h-0 lg:py-20">
            {/* Left Content */}
            <div className="z-[2] animate-fadeIn">
              <h1 className="font-bebas text-[clamp(5rem,13vw,12rem)] md:text-[5rem] sm:text-[4rem] leading-[0.9] mb-8">
                FAIR FOOD
                <br />
                <span className="text-neon-pink [text-shadow:0_0_30px_rgba(255,0,119,0.5)] animate-neonGlow">
                  DELIVERED
                </span>
                <br />
                <span className="text-transparent [-webkit-text-stroke:2px_#ffffff]">
                  TO YOU
                </span>
              </h1>

              <p className="text-text-gray text-[clamp(1rem,2vw,1.25rem)] mb-10 leading-relaxed max-w-[500px]">
                Order your favorite fair foods from local vendors.
                <br />
                Fresh. Fast. Fair. ⚡
              </p>

              {/* Address + Schedule Input Bar */}
              <div className="bg-bg-card border border-white/10 rounded-2xl p-3 max-w-[600px] md:max-w-full focus-within:border-neon-pink focus-within:shadow-glow transition-all duration-300">

                {/* Row 1: Location input + Schedule dropdown */}
                <div className="flex items-center gap-2 mb-2">
                  {/* Location Input */}
                  <div className="flex items-center gap-2 flex-1 px-3 py-2">
                    <MapPinIcon className="w-5 h-5 text-neon-pink flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="Delivery address"
                      className="bg-transparent border-0 text-white outline-none flex-1 text-[1rem] placeholder:text-text-gray w-full"
                    />
                  </div>

                  {/* Divider */}
                  <div className="w-px h-8 bg-white/10 flex-shrink-0" />

                  {/* Schedule Dropdown */}
                  <div className="relative flex-shrink-0" ref={scheduleRef}>
                    <button
                      className="flex items-center gap-1.5 px-3 py-2 text-text-gray hover:text-white transition-colors duration-300 whitespace-nowrap bg-transparent border-0 cursor-pointer text-[0.875rem]"
                      onClick={() => setScheduleOpen(!scheduleOpen)}
                    >
                      <ClockIcon className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium hidden sm:inline">
                        {scheduleOption === "now" ? "Deliver now" : "Schedule later"}
                      </span>
                      <span className="font-medium sm:hidden">
                        {scheduleOption === "now" ? "Now" : "Later"}
                      </span>
                      <ChevronDownIcon
                        className={`w-4 h-4 transition-transform duration-200 ${scheduleOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {scheduleOpen && (
                      <div className="absolute top-full right-0 mt-2 bg-bg-card border border-white/10 rounded-xl overflow-hidden shadow-xl z-50 min-w-[200px]">
                        <button
                          className={`w-full px-4 py-3 text-left text-[0.875rem] flex items-center gap-2 border-0 cursor-pointer transition-colors duration-200 ${
                            scheduleOption === "now"
                              ? "bg-neon-pink/10 text-neon-pink"
                              : "bg-transparent text-text-gray hover:text-white hover:bg-white/5"
                          }`}
                          onClick={() => {
                            setScheduleOption("now");
                            setScheduleOpen(false);
                          }}
                        >
                          ⚡ Deliver now
                        </button>
                        <button
                          className={`w-full px-4 py-3 text-left text-[0.875rem] flex items-center gap-2 border-0 cursor-pointer transition-colors duration-200 ${
                            scheduleOption === "later"
                              ? "bg-neon-pink/10 text-neon-pink"
                              : "bg-transparent text-text-gray hover:text-white hover:bg-white/5"
                          }`}
                          onClick={() => {
                            setScheduleOption("later");
                            setScheduleOpen(false);
                          }}
                        >
                          📅 Schedule for later
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 2: Find Food — full width */}
                <Link
                  to="/home"
                  className="block w-full bg-neon-pink text-white px-6 py-3 rounded-xl font-bold uppercase tracking-wide text-[0.875rem] transition-all duration-300 hover:bg-[#e0006b] hover:shadow-glow no-underline text-center"
                >
                  Find Food
                </Link>
              </div>

              <p className="text-text-gray text-sm mt-5">
                Already have an account?{" "}
                <SignInButton mode="modal" forceRedirectUrl="/home">
                  <button className="text-neon-pink font-semibold bg-transparent border-0 cursor-pointer hover:underline text-sm">
                    Sign in
                  </button>
                </SignInButton>
              </p>
            </div>

            {/* Right Side — Logo */}
            <div className="hidden md:flex relative items-center justify-center min-h-[500px]">
              <div className="relative">
                <div className="absolute -inset-16 bg-[radial-gradient(circle,rgba(255,0,119,0.15),transparent_70%)] pointer-events-none" />
                <img
                  src="/images/logo/fairdash-full-black.png"
                  alt="FairDash — Fresh. Fast. Fair."
                  className="w-[420px] h-auto relative z-10 drop-shadow-[0_0_40px_rgba(255,0,119,0.5)]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Background glow */}
        <div className="absolute -top-1/2 -right-1/5 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(255,0,119,0.12)_0%,transparent_70%)] animate-float-slow pointer-events-none" />
      </section>

      {/* ===== STATS BAR ===== */}
      <section className="py-8 border-y border-white/5 bg-bg-card/50">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
          <div className="flex justify-around items-center flex-wrap gap-6">
            <div className="text-center">
              <div className="font-bebas text-4xl text-neon-pink [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
                500+
              </div>
              <div className="text-text-gray text-xs uppercase tracking-wide">
                Orders Delivered
              </div>
            </div>
            <div className="text-center">
              <div className="font-bebas text-4xl text-neon-pink [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
                30min
              </div>
              <div className="text-text-gray text-xs uppercase tracking-wide">
                Avg Delivery Time
              </div>
            </div>
            <div className="text-center">
              <div className="font-bebas text-4xl text-neon-pink [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
                4.8★
              </div>
              <div className="text-text-gray text-xs uppercase tracking-wide">
                Customer Rating
              </div>
            </div>
            <div className="text-center">
              <div className="font-bebas text-4xl text-neon-pink [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
                20+
              </div>
              <div className="text-text-gray text-xs uppercase tracking-wide">
                Fair Food Items
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== VENDOR / DRIVER SECTION ===== */}
      <section className="py-20 lg:py-16 md:py-12 bg-bg-card">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Become a Vendor Card */}
            <div className="relative rounded-3xl overflow-hidden bg-[#1a1a1a] border border-white/5 group hover:border-neon-pink/30 transition-all duration-300">
              {/* Image with overlay */}
              <div className="relative h-64 overflow-hidden">
                <img
                  src="/images/landing/fair-food-vendor.jpg"
                  alt="Fair food vendor display"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] via-[#1a1a1a]/60 to-transparent" />
              </div>

              {/* Content */}
              <div className="relative p-10 lg:p-8 md:p-6 -mt-16">
                <h3 className="font-bebas text-4xl md:text-3xl mb-3 tracking-wide text-white drop-shadow-lg">
                  Become a Vendor
                </h3>
                <p className="text-text-gray text-lg md:text-base leading-relaxed mb-6 max-w-[400px] md:max-w-full">
                  Partner with FairDash and reach thousands of fair food lovers in
                  your area.
                </p>
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 text-neon-pink font-semibold uppercase tracking-wide text-sm no-underline hover:gap-3 transition-all duration-300"
                >
                  Partner With Us <ArrowRightIcon className="w-4 h-4" />
                </Link>
              </div>
              <div className="absolute top-0 right-0 w-40 h-40 bg-[radial-gradient(circle,rgba(255,0,119,0.1),transparent_70%)] pointer-events-none" />
            </div>

            {/* Become a Driver Card */}
            <div className="relative rounded-3xl overflow-hidden bg-[#1a1a1a] border border-white/5 group hover:border-neon-pink/30 transition-all duration-300">
              {/* Image with overlay */}
              <div className="relative h-64 overflow-hidden">
                <img
                  src="/images/landing/delivery-driver.jpg"
                  alt="Delivery driver on motorcycle"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] via-[#1a1a1a]/60 to-transparent" />
              </div>

              {/* Content */}
              <div className="relative p-10 lg:p-8 md:p-6 -mt-16">
                <h3 className="font-bebas text-4xl md:text-3xl mb-3 tracking-wide text-white drop-shadow-lg">
                  Become a Driver
                </h3>
                <p className="text-text-gray text-lg md:text-base leading-relaxed mb-6 max-w-[400px] md:max-w-full">
                  Join our delivery team and earn money delivering fair food to
                  happy customers.
                </p>
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 text-neon-pink font-semibold uppercase tracking-wide text-sm no-underline hover:gap-3 transition-all duration-300"
                >
                  Apply to Drive <ArrowRightIcon className="w-4 h-4" />
                </Link>
              </div>
              <div className="absolute top-0 right-0 w-40 h-40 bg-[radial-gradient(circle,rgba(255,0,119,0.1),transparent_70%)] pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* ===== LANDING FOOTER ===== */}
      <footer className="bg-bg-dark border-t border-white/10 py-12 md:py-8">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">

          {/* Logo + tagline */}
          <div className="mb-8">
            <img
              src="/images/logo/fairdash-logo.png"
              alt="FairDash"
              className="w-40 mb-3 drop-shadow-[0_0_15px_rgba(255,0,119,0.4)]"
            />
            <p className="text-text-gray text-[0.875rem] leading-relaxed max-w-[260px]">
              The fair comes to your door. Fresh. Fast. Fair.
            </p>
          </div>

          {/* Footer nav columns — grid: 3 cols on desktop, 1 on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">

            <div>
              <h4 className="font-bebas text-[1rem] tracking-wide mb-3 text-neon-pink">
                Company
              </h4>
              <ul className="list-none p-0 space-y-2">
                <li>
                  <Link to="/contact"
                    className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">
                    Contact Us
                  </Link>
                </li>
                <li>
                  <Link to="/refund-policy"
                    className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">
                    Refund Policy
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-bebas text-[1rem] tracking-wide mb-3 text-neon-pink">
                Join Us
              </h4>
              <ul className="list-none p-0 space-y-2">
                <li>
                  <Link to="/contact"
                    className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">
                    Become a Vendor
                  </Link>
                </li>
                <li>
                  <Link to="/contact"
                    className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">
                    Become a Driver
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-bebas text-[1rem] tracking-wide mb-3 text-neon-pink">
                Connect
              </h4>
              <ul className="list-none p-0 space-y-2">
                <li>
                  <a href="https://www.facebook.com/fairdash217"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">
                    Facebook
                  </a>
                </li>
                <li>
                  <a href="mailto:fairdash217@gmail.com"
                    className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">
                    Email Us
                  </a>
                </li>
              </ul>
            </div>

          </div>

          {/* Bottom row - copyright + social */}
          <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-0">
            <p className="text-text-gray text-[0.875rem] m-0">
              &copy; 2026 FairDash. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="mailto:fairdash217@gmail.com"
                aria-label="Email"
                className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neon-pink transition-all duration-300 hover:bg-neon-pink hover:text-white hover:scale-110">
                <FaEnvelope className="w-4 h-4" />
              </a>
              <a href="https://www.facebook.com/fairdash217"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neon-pink transition-all duration-300 hover:bg-neon-pink hover:text-white hover:scale-110">
                <FaFacebookF className="w-4 h-4" />
              </a>
            </div>
          </div>

        </div>
      </footer>
    </div>
  );
};

export default Landing;
