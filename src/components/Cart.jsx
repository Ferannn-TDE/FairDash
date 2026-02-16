import { useRef, useState } from "react";
import {
  XMarkIcon,
  PlusIcon,
  MinusIcon,
  ShoppingBagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useCart } from "../context/CartContext";

const CartItem = ({ item, updateQuantity, removeFromCart }) => {
  const touchStartX = useRef(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isRemoving, setIsRemoving] = useState(false);
  const cardRef = useRef(null);

  const THRESHOLD = 100; // px — auto-delete fires once dragged past this

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    if (touchStartX.current === null || isRemoving) return;
    const diff = e.touches[0].clientX - touchStartX.current;

    // Only allow left swipe
    if (diff < 0) {
      const newOffset = Math.max(diff, -160);
      setSwipeOffset(newOffset);

      // Auto-trigger removal as soon as threshold is crossed while dragging
      if (newOffset <= -THRESHOLD) {
        triggerRemove();
      }
    }
  };

  const handleTouchEnd = () => {
    if (!isRemoving) {
      // Didn't reach threshold — snap back
      setSwipeOffset(0);
    }
    touchStartX.current = null;
  };

  const triggerRemove = () => {
    const cardWidth = cardRef.current?.offsetWidth || 400;
    setIsRemoving(true);
    setSwipeOffset(-cardWidth); // fly off screen completely
    setTimeout(() => removeFromCart(item.id), 300);
  };

  return (
    <div className="relative mb-[15px] overflow-hidden rounded-2xl">
      {/* Red delete background — only visible when swiping */}
      <div
        className={`absolute inset-0 bg-red-600 flex items-center justify-end pr-5 rounded-2xl transition-opacity duration-150 ${
          swipeOffset < -10 ? "opacity-100" : "opacity-0"
        }`}
      >
        <span className="text-white font-bold text-sm uppercase tracking-wide flex items-center gap-2">
          <TrashIcon className="w-5 h-5" />
          Remove
        </span>
      </div>

      {/* Actual card */}
      <div
        ref={cardRef}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition:
            isRemoving || swipeOffset === 0
              ? "transform 0.3s ease-out, opacity 0.3s ease-out"
              : "none",
          opacity: isRemoving ? 0 : 1,
        }}
        className="flex items-center gap-[15px] p-5 bg-bg-card rounded-2xl relative border border-transparent hover:border-neon-pink/30 hover:bg-bg-card/80 transition-colors duration-300"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="text-[40px]">{item.emoji}</div>
        <div className="flex-1">
          <div className="font-semibold mb-1">{item.name}</div>
          <div className="text-neon-pink font-bold text-sm">
            ${item.price.toFixed(2)}
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-full">
          <button
            className="bg-transparent border-0 text-white cursor-pointer p-1 flex items-center justify-center transition-all duration-300 ease-out hover:text-neon-pink hover:scale-110"
            onClick={() => updateQuantity(item.id, item.quantity - 1)}
          >
            <MinusIcon className="w-4 h-4" />
          </button>
          <span className="font-bold min-w-[24px] text-center">
            {item.quantity}
          </span>
          <button
            className="bg-transparent border-0 text-white cursor-pointer p-1 flex items-center justify-center transition-all duration-300 ease-out hover:text-neon-pink hover:scale-110"
            onClick={() => updateQuantity(item.id, item.quantity + 1)}
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

const Cart = () => {
  const {
    cart,
    removeFromCart,
    updateQuantity,
    getCartTotal,
    isCartOpen,
    setIsCartOpen,
  } = useCart();

  if (!isCartOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 z-[999] animate-fadeIn"
        onClick={() => setIsCartOpen(false)}
      />
      <div className="fixed top-0 right-0 w-[450px] md:w-[450px] xs:w-full h-screen bg-bg-dark z-[1000] flex flex-col animate-slideInRight border-l border-white/10">
        <div className="p-[30px] border-b border-white/10 flex justify-between items-center">
          <div className="flex items-center gap-3 text-neon-pink">
            <ShoppingBagIcon className="w-6 h-6" />
            <h2 className="text-2xl m-0 font-bebas tracking-wide">
              Your Order
            </h2>
          </div>
          <button
            className="bg-transparent border-0 text-text-gray cursor-pointer p-2 transition-all duration-300 ease-out hover:text-white hover:rotate-90"
            onClick={() => setIsCartOpen(false)}
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <div className="relative mb-8">
              <div className="relative w-36 h-36 rounded-2xl border border-neon-pink/30 bg-bg-dark flex items-center justify-center shadow-glow overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,0,119,0.08),transparent_70%)]" />
                <img
                  src="/images/image4.png"
                  alt="FairDash"
                  className="w-28 h-auto relative z-10 animate-float mix-blend-screen"
                  onError={(e) => {
                    e.target.style.display = "none";
                    e.target.nextSibling.style.display = "block";
                  }}
                />
                <div className="font-bebas text-4xl text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)] hidden">
                  FAIR<span className="text-neon-pink">DASH</span>
                </div>
              </div>
            </div>
            <h3 className="font-bebas text-2xl mb-2.5 tracking-wide text-white">
              Your cart is empty
            </h3>
            <p className="text-text-gray text-sm leading-relaxed max-w-[200px]">
              Add some fair favorites to get started!
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 px-[30px]">
              {cart.map((item) => (
                <CartItem
                  key={item.id}
                  item={item}
                  updateQuantity={updateQuantity}
                  removeFromCart={removeFromCart}
                />
              ))}
            </div>

            <div className="p-[30px] border-t border-white/10 bg-bg-dark">
              <div className="mb-5">
                <div className="flex justify-between mb-3 text-text-gray text-sm">
                  <span>Subtotal</span>
                  <span>${getCartTotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between mb-3 text-text-gray text-sm">
                  <span>Delivery Fee</span>
                  <span>$2.99</span>
                </div>
                <div className="flex justify-between text-white text-lg font-bold pt-3 border-t border-white/10 mt-3">
                  <span>Total</span>
                  <span>${(getCartTotal() + 2.99).toFixed(2)}</span>
                </div>
              </div>
              <button className="w-full py-4 bg-neon-pink border-0 text-white font-bold text-base rounded-xl cursor-pointer transition-all duration-300 ease-out uppercase tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense">
                Checkout • ${(getCartTotal() + 2.99).toFixed(2)}
              </button>
              <p className="text-center mt-[15px] text-text-gray text-[13px]">
                ⚡ 30-minute delivery guarantee
              </p>

              {/* Payment Methods */}
              <div className="mt-5 pt-5 border-t border-white/5">
                <p className="text-center text-xs text-text-gray mb-3 uppercase tracking-wide">
                  We Accept
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <img
                    src="/images/payments/cashapp.svg"
                    alt="Cash App"
                    className="h-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  />
                  <img
                    src="/images/payments/applepay.svg"
                    alt="Apple Pay"
                    className="h-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  />
                  <img
                    src="/images/payments/googlepay.svg"
                    alt="Google Pay"
                    className="h-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  />
                  <img
                    src="/images/payments/visa.svg"
                    alt="Visa"
                    className="h-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  />
                  <img
                    src="/images/payments/mastercard.svg"
                    alt="Mastercard"
                    className="h-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  />
                  <img
                    src="/images/payments/americanexpress.svg"
                    alt="American Express"
                    className="h-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default Cart;
