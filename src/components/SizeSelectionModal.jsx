import { XMarkIcon } from '@heroicons/react/24/outline';
import { formatPrice } from '../utils/vendorData';

const SizeSelectionModal = ({ item, isOpen, onClose, onSelectSize }) => {
  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-bg-card border border-white/10 rounded-2xl p-6 max-w-sm w-full z-10 animate-fadeIn">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-gray hover:text-white transition-colors bg-transparent border-0 cursor-pointer p-1"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-5 pr-6">
          <h3 className="font-bebas text-2xl tracking-wide text-white mb-1">
            Choose Size
          </h3>
          <p className="text-text-gray text-sm">{item.name}</p>
        </div>

        {/* Size options */}
        <div className="space-y-2.5">
          {item.sizes.map((size) => (
            <button
              key={size.name}
              onClick={() => onSelectSize({ ...item, price: size.price, sizeName: size.name })}
              className="w-full p-4 bg-bg-dark border border-white/10 rounded-xl hover:border-neon-pink/40 hover:bg-white/5 transition-all duration-200 flex items-center justify-between cursor-pointer text-left"
            >
              <span className="text-white font-semibold">{size.name}</span>
              <span className="text-neon-pink font-bold">${size.price.toFixed(2)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SizeSelectionModal;
