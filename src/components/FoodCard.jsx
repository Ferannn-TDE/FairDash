import { ClockIcon, PlusIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useUser, useClerk } from '@clerk/clerk-react';
import { useCart } from '../context/CartContext';
import { formatPrice, getVendorById } from '../utils/vendorData';

const FoodCard = ({ item }) => {
  const { addToCart } = useCart();
  const { isSignedIn } = useUser();
  const { openSignIn } = useClerk();

  const handleAddToCart = () => {
    if (!isSignedIn) {
      toast.error("Sign in to add items to your cart");
      openSignIn();
      return;
    }
    addToCart(item);
    toast.success(`${item.name} added to cart! 🎉`);
  };

  const deliveryTime =
    item.deliveryTime || getVendorById(item.vendorId)?.deliveryTime;

  return (
    <div className="bg-bg-card rounded-xl md:rounded-2xl overflow-hidden border border-white/5 transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-glow hover:border-neon-pink/30 flex flex-col h-full animate-fadeIn">

      {/* Image — fixed aspect ratio */}
      <div className="relative w-full aspect-square bg-gradient-to-br from-[#252525] to-bg-card flex-shrink-0 overflow-hidden before:content-[''] before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.08)_0%,transparent_70%)]">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover relative z-10"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center relative z-10">
            <span className="text-5xl md:text-6xl">{item.emoji}</span>
          </div>
        )}

        {deliveryTime && (
          <div className="absolute bottom-2 right-2 md:bottom-3 md:right-3 bg-black/90 px-2 py-1 md:px-3 md:py-1.5 rounded-full text-[0.625rem] md:text-xs font-bold border border-neon-pink flex items-center gap-1 text-neon-pink z-[2]">
            <ClockIcon className="w-3 h-3" />
            {deliveryTime}
          </div>
        )}

        {item.popular && (
          <div className="absolute top-2 left-2 md:top-3 md:left-3 bg-neon-pink px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[0.625rem] md:text-xs font-bold z-[2]">
            🔥 Popular
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 md:p-5 flex flex-col flex-1">

        {/* Name + Price */}
        <div className="flex items-start justify-between gap-1.5 mb-2 min-h-[2.5rem] md:min-h-[3rem]">
          <div className="font-bebas text-base md:text-xl tracking-[0.03125rem] leading-tight line-clamp-2 flex-1 text-white">
            {item.name}
          </div>
          <div className="text-neon-pink font-bold text-base md:text-xl whitespace-nowrap [text-shadow:0_0_20px_rgba(255,0,119,0.4)] flex-shrink-0">
            {formatPrice(item)}
          </div>
        </div>

        {/* Description */}
        <p className="text-text-gray text-[0.6875rem] md:text-sm leading-relaxed line-clamp-2 mb-2 md:mb-3 min-h-[2rem] md:min-h-[2.5rem]">
          {item.description}
        </p>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2 md:mb-3 min-h-[1.25rem]">
            {item.tags.slice(0, 2).map((tag, index) => (
              <span
                key={index}
                className="bg-white/5 text-text-gray px-1.5 py-0.5 md:px-3 md:py-1 rounded-xl text-[0.5625rem] md:text-[0.6875rem] font-medium uppercase tracking-[0.03125rem] border border-white/5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Add to Cart — pinned to bottom */}
        <button
          className="mt-auto w-full py-2 md:py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-lg md:rounded-xl cursor-pointer transition-all duration-300 ease-out flex items-center justify-center gap-1.5 md:gap-2 uppercase tracking-wide text-[0.6875rem] md:text-sm hover:bg-neon-pink hover:border-neon-pink hover:shadow-glow"
          onClick={handleAddToCart}
        >
          <PlusIcon className="w-3 h-3 md:w-[1.125rem] md:h-[1.125rem]" />
          Add to Cart
        </button>
      </div>
    </div>
  );
};

export default FoodCard;
