import { useState, useEffect } from "react";

const LoadingAnimation = ({ onComplete }) => {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Start fade out after 1.5s
    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, 1500);

    // Call onComplete after fade completes (2s total)
    const completeTimer = setTimeout(() => {
      if (onComplete) {
        onComplete();
      }
    }, 2000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-bg-dark flex flex-col items-center justify-center transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* FairDash Logo with neon glow */}
      <div className="text-center mb-8 animate-float">
        <img
          src="/images/image4.png"
          alt="FairDash Logo"
          className="w-64 md:w-80 mx-auto mb-4 drop-shadow-[0_0_30px_rgba(255,0,119,0.6)]"
        />
        <p className="text-text-gray text-sm md:text-base uppercase tracking-widest">
          The Fair is Coming to YOU
        </p>
      </div>

      {/* Animated Spinner */}
      <div className="relative w-20 h-20">
        {/* Outer ring */}
        <div className="absolute inset-0 border-4 border-neon-pink/20 rounded-full"></div>

        {/* Spinning ring */}
        <div className="absolute inset-0 border-4 border-transparent border-t-neon-pink rounded-full animate-spin shadow-glow"></div>

        {/* Inner glow pulse */}
        <div className="absolute inset-2 bg-neon-pink/10 rounded-full animate-pulse-custom shadow-glow"></div>
      </div>

      {/* Loading text */}
      {/* <p className="mt-6 text-white/60 text-sm uppercase tracking-wider animate-pulse-custom">
        Loading your experience...
      </p> */}
    </div>
  );
};

export default LoadingAnimation;
