import { useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

const SidePanel = ({ isOpen, onClose, type, children }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  return (
    <>
      {/* Overlay — conditionally rendered */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-[999] animate-fadeIn"
          onClick={onClose}
        />
      )}

      {/* Panel — always in DOM, slides from right */}
      <div
        className={`fixed top-0 right-0 h-screen w-[95%] sm:w-[90%] md:w-[450px] bg-bg-dark border-l border-white/10 z-[1000] transform transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <img
              src="/images/image4.png"
              alt="FairDash"
              className="h-8 w-auto mix-blend-screen"
            />
            <span className="font-bebas text-xl tracking-[2px] text-white">
              FAIR<span className="text-neon-pink">DASH</span>
            </span>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors duration-300 bg-transparent border-0 cursor-pointer"
            aria-label="Close"
          >
            <XMarkIcon className="w-6 h-6 text-text-gray hover:text-white transition-colors" />
          </button>
        </div>

        {/* Content — flex col so Cart can have sticky footer */}
        <div className="h-[calc(100vh-88px)] overflow-y-auto pb-20">{children}</div>
      </div>
    </>
  );
};

export default SidePanel;
