import { XMarkIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

const SignOutModal = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/70 z-[1001] animate-fadeIn"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1002] w-[90%] max-w-md animate-fadeIn">
        <div className="bg-bg-card border border-white/10 rounded-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">

          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-neon-pink/20 to-neon-pink/5 border border-neon-pink/20 flex items-center justify-center">
              <ArrowRightOnRectangleIcon className="w-6 h-6 text-neon-pink" />
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-white/5 rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
            >
              <XMarkIcon className="w-5 h-5 text-text-gray hover:text-white transition-colors" />
            </button>
          </div>

          {/* Content */}
          <h3 className="font-bebas text-2xl tracking-wide text-white mb-2">
            Sign Out?
          </h3>
          <p className="text-text-gray text-sm mb-6 leading-relaxed">
            Are you sure you want to sign out? You'll need to sign in again to place orders.
          </p>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="flex-1 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] hover:shadow-glow"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default SignOutModal;
