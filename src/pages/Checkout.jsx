import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CreditCardIcon,
  BanknotesIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useCart } from '../context/CartContext';

const inputClass =
  'w-full p-3 bg-bg-dark border border-white/10 rounded-xl text-white placeholder:text-text-gray focus:border-neon-pink focus:outline-none transition-colors duration-200 text-sm';

const labelClass = 'block text-sm font-semibold text-white mb-2';

const Checkout = () => {
  const navigate = useNavigate();
  const { cart, getCartTotal, getCartCount, clearCart } = useCart();
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: sessionStorage.getItem('deliveryAddress') || '',
    instructions: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
  });

  const cartTotal = getCartTotal();
  const cartCount = getCartCount();
  const deliveryFee = 2.99;
  const tax = cartTotal * 0.08;
  const grandTotal = cartTotal + deliveryFee + tax;

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePlaceOrder = () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) {
      toast.error('Please fill in all required delivery fields.');
      return;
    }
    if (paymentMethod === 'card' && (!form.cardNumber.trim() || !form.expiry.trim() || !form.cvv.trim())) {
      toast.error('Please fill in all card details.');
      return;
    }
    toast.success('Order placed! 🎉 Your food is on its way.');
    clearCart();
    navigate('/home');
  };

  if (cartCount === 0) {
    return (
      <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center pt-20 text-center px-4">
        <div className="text-5xl mb-4">🛒</div>
        <h2 className="font-bebas text-3xl text-white mb-2">Your cart is empty</h2>
        <p className="text-text-gray mb-6">Add some fair food before checking out.</p>
        <button
          onClick={() => navigate('/menu')}
          className="px-6 py-3 bg-neon-pink text-white font-bold rounded-xl hover:bg-[#e0006b] transition-colors"
        >
          Browse Menu
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-dark pt-20 pb-12">
      {/* Header */}
      <div className="sticky top-[4.5rem] z-10 bg-bg-dark/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[75rem] mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
          >
            <ArrowLeftIcon className="w-5 h-5 text-white" />
          </button>
          <h1 className="font-bebas text-2xl tracking-wide text-white">Checkout</h1>
        </div>
      </div>

      <div className="max-w-[75rem] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Left: Forms ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Delivery Info */}
            <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <MapPinIcon className="w-5 h-5 text-neon-pink" />
                <h2 className="font-bebas text-xl tracking-wide text-white">Delivery Information</h2>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Full Name *</label>
                    <input
                      type="text"
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      className={inputClass}
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Phone Number *</label>
                    <input
                      type="tel"
                      name="phone"
                      value={form.phone}
                      onChange={handleChange}
                      className={inputClass}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Delivery Address *</label>
                  <input
                    type="text"
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    className={inputClass}
                    placeholder="147 E Grove Ave, Collinsville, IL"
                  />
                </div>
                <div>
                  <label className={labelClass}>Delivery Instructions <span className="text-text-gray font-normal">(Optional)</span></label>
                  <textarea
                    name="instructions"
                    value={form.instructions}
                    onChange={handleChange}
                    className={`${inputClass} resize-none`}
                    rows={3}
                    placeholder="Leave at door, ring bell, etc."
                  />
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <CreditCardIcon className="w-5 h-5 text-neon-pink" />
                <h2 className="font-bebas text-xl tracking-wide text-white">Payment Method</h2>
              </div>

              <div className="space-y-3 mb-5">
                <button
                  onClick={() => setPaymentMethod('card')}
                  className={`w-full p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${
                    paymentMethod === 'card'
                      ? 'border-neon-pink bg-neon-pink/10'
                      : 'border-white/10 bg-transparent hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <CreditCardIcon className="w-5 h-5 text-white flex-shrink-0" />
                    <span className="text-white font-semibold text-sm">Credit / Debit Card</span>
                  </div>
                </button>

                <button
                  onClick={() => setPaymentMethod('cash')}
                  className={`w-full p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${
                    paymentMethod === 'cash'
                      ? 'border-neon-pink bg-neon-pink/10'
                      : 'border-white/10 bg-transparent hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <BanknotesIcon className="w-5 h-5 text-white flex-shrink-0" />
                    <span className="text-white font-semibold text-sm">Cash on Delivery</span>
                  </div>
                </button>
              </div>

              {paymentMethod === 'card' && (
                <div className="space-y-4 pt-2 border-t border-white/10">
                  <div className="pt-4">
                    <label className={labelClass}>Card Number</label>
                    <input
                      type="text"
                      name="cardNumber"
                      value={form.cardNumber}
                      onChange={handleChange}
                      className={inputClass}
                      placeholder="1234 5678 9012 3456"
                      maxLength={19}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Expiry Date</label>
                      <input
                        type="text"
                        name="expiry"
                        value={form.expiry}
                        onChange={handleChange}
                        className={inputClass}
                        placeholder="MM/YY"
                        maxLength={5}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>CVV</label>
                      <input
                        type="text"
                        name="cvv"
                        value={form.cvv}
                        onChange={handleChange}
                        className={inputClass}
                        placeholder="123"
                        maxLength={4}
                      />
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === 'cash' && (
                <p className="text-text-gray text-sm pt-2 border-t border-white/10 pt-4">
                  💵 Have exact cash ready. Our driver will collect payment on delivery.
                </p>
              )}
            </div>
          </div>

          {/* ── Right: Order Summary ── */}
          <div className="lg:col-span-1">
            <div className="bg-bg-card border border-white/10 rounded-2xl p-6 sticky top-36">
              <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Order Summary</h2>

              {/* Items */}
              <div className="space-y-3 mb-5 max-h-64 overflow-y-auto -mx-1 px-1">
                {cart.map((item) => (
                  <div key={`${item.id}-${item.sizeName || ''}`} className="flex gap-3 pb-3 border-b border-white/5 last:border-0 last:pb-0">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-14 h-14 object-cover rounded-lg flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-bg-dark flex items-center justify-center flex-shrink-0 text-2xl">
                        {item.emoji}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{item.name}</p>
                      {item.sizeName && (
                        <p className="text-text-gray text-xs">{item.sizeName}</p>
                      )}
                      <p className="text-neon-pink font-bold text-sm mt-0.5">
                        {item.quantity} × ${item.price.toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-2 pb-4 border-b border-white/10 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-gray">Subtotal</span>
                  <span className="text-white">${cartTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-gray">Delivery Fee</span>
                  <span className="text-white">${deliveryFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-gray">Tax (8%)</span>
                  <span className="text-white">${tax.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex justify-between py-4 mb-4">
                <span className="text-white font-bold">Total</span>
                <span className="text-neon-pink font-bold text-xl">${grandTotal.toFixed(2)}</span>
              </div>

              <button
                onClick={handlePlaceOrder}
                className="w-full py-4 bg-neon-pink text-black font-bold rounded-xl hover:bg-[#ff3399] transition-colors duration-200 uppercase tracking-wide border-0 cursor-pointer"
              >
                Place Order
              </button>

              <p className="text-text-gray text-xs text-center mt-4">
                ⚡ 30-minute delivery guarantee
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Checkout;
