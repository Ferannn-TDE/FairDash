import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";

const SignOutModal = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[1001]"
        onClick={onClose}
      />

      {/* Modal Wrapper (flex centered instead of translate centering) */}
      <div className="fixed inset-0 z-[1002] flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-bg-card border border-white/10 rounded-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)] animate-fadeIn">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bebas text-3xl tracking-wide text-white">
              Sign Out?
            </h3>

            <button
              onClick={onClose}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors duration-200 bg-transparent border-0 cursor-pointer"
            >
              <XMarkIcon className="w-5 h-5 text-text-gray hover:text-white transition-colors" />
            </button>
          </div>

          {/* Content */}
          <p className="text-text-gray text-sm mb-6 leading-relaxed">
            Are you sure you want to sign out? You'll need to sign in again to
            place orders.
          </p>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 hover:border-white/20 active:scale-[0.97] transition-all duration-200 cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="flex-1 py-3 bg-red-500 text-white rounded-xl font-semibold text-sm hover:bg-red-600 active:bg-red-700 active:scale-[0.97] transition-all duration-200 cursor-pointer border-0"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default SignOutModal;
