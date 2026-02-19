import { ClockIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useCart } from '../context/CartContext';
import { formatPrice, getVendorById } from '../utils/vendorData';

const FoodCard = ({ item }) => {
  const { addToCart } = useCart();

  const handleAddToCart = () => {
    addToCart(item);
  };

  return (
    <div className="bg-bg-card rounded-3xl overflow-hidden transition-all duration-300 ease-out relative border border-white/5 animate-fadeIn hover:scale-[1.02] hover:shadow-glow hover:border-neon-pink">
      <div className="h-[200px] md:h-[200px] xs:h-[180px] bg-gradient-to-br from-[#252525] to-bg-card flex items-center justify-center relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.1)_0%,transparent_70%)]">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover relative z-10"
          />
        ) : (
          <span className="text-[5rem] md:text-[5rem] xs:text-[3.75rem] relative z-10 animate-float">
            {item.emoji}
          </span>
        )}

        {(item.deliveryTime || (item.vendorId && getVendorById(item.vendorId)?.deliveryTime)) && (
          <div className="absolute bottom-3 right-3 bg-black/90 px-3.5 py-1.5 rounded-full text-xs font-bold border border-neon-pink flex items-center gap-1.5 text-neon-pink z-[2]">
            <ClockIcon className="w-3.5 h-3.5" />
            {item.deliveryTime || getVendorById(item.vendorId)?.deliveryTime}
          </div>
        )}

        {item.popular && (
          <div className="absolute top-3 left-3 bg-neon-pink px-3.5 py-1.5 rounded-full text-xs font-bold z-[2] animate-pulse-custom">
            🔥 Popular
          </div>
        )}
      </div>

      <div className="p-6 md:p-6 xs:p-5">
        <div className="flex justify-between items-start mb-3 gap-3">
          <div className="text-xl font-bold font-bebas tracking-[0.5px] flex-1">
            {item.name}
          </div>
          <div className="text-neon-pink font-bold text-xl [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
            {formatPrice(item)}
          </div>
        </div>

        <div className="text-text-gray text-sm leading-relaxed mb-4">
          {item.description}
        </div>

        {item.tags && (
          <div className="flex flex-wrap gap-2 mb-4">
            {item.tags.map((tag, index) => (
              <span
                key={index}
                className="bg-white/5 text-text-gray px-3 py-1 rounded-xl text-[0.6875rem] font-medium uppercase tracking-[0.5px] border border-white/5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <button
          className="w-full py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-xl cursor-pointer transition-all duration-300 ease-out flex items-center justify-center gap-2 uppercase tracking-wide text-sm hover:bg-neon-pink hover:border-neon-pink hover:shadow-glow"
          onClick={handleAddToCart}
        >
          <PlusIcon className="w-[18px] h-[18px]" />
          Add to Cart
        </button>
      </div>
    </div>
  );
};

export default FoodCard;
