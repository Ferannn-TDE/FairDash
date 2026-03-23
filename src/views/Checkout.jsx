import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BuildingStorefrontIcon,
  TruckIcon,
  HomeIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useUser } from '@clerk/clerk-react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripe } from '../lib/stripe';
import { useCart } from '../context/CartContext';

const inputClass =
  'w-full p-3 bg-bg-dark border border-white/10 rounded-xl text-white placeholder:text-text-gray focus:border-neon-pink focus:outline-none transition-colors duration-200 text-sm';
const labelClass = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5';
const sectionClass = 'bg-bg-card border border-white/10 rounded-2xl p-6';

const FULFILLMENT_OPTIONS = [
  {
    value: 'BOOTH_PICKUP',
    label: 'Booth Pickup',
    sub: 'Walk to the vendor booth',
    icon: BuildingStorefrontIcon,
  },
  {
    value: 'CURBSIDE',
    label: 'Curbside',
    sub: 'We bring it to your car',
    icon: TruckIcon,
  },
  {
    value: 'HOME_DELIVERY',
    label: 'Home Delivery',
    sub: 'Deliver to your address',
    icon: HomeIcon,
  },
];

// ─── Payment step (rendered inside <Elements>) ─────────────────────────────

const PaymentStep = ({ orderId, summary, onBack, onSuccess }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/home',
        },
        redirect: 'if_required',
      });

      if (error) {
        toast.error(error.message ?? 'Payment failed — please try again');
      } else if (paymentIntent?.status === 'succeeded') {
        onSuccess();
      }
    } catch {
      toast.error('Something went wrong — please try again');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={sectionClass}>
        <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Payment</h2>
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: { billingDetails: { address: 'never' } },
          }}
        />
      </div>

      {/* Summary card */}
      <div className={sectionClass}>
        <h2 className="font-bebas text-xl tracking-wide text-white mb-4">Order Total</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-text-gray">Subtotal</span><span className="text-white">${summary.subtotal.toFixed(2)}</span></div>
          {summary.deliveryFee != null && (
            <div className="flex justify-between"><span className="text-text-gray">Delivery Fee</span><span className="text-white">${summary.deliveryFee.toFixed(2)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-text-gray">Platform Fee</span><span className="text-white">${summary.fairSynqFee.toFixed(2)}</span></div>
          <div className="flex justify-between pt-3 border-t border-white/10">
            <span className="text-white font-bold">Total</span>
            <span className="text-neon-pink font-bold text-xl">${summary.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold hover:bg-white/10 transition-colors cursor-pointer border-0"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handlePay}
          disabled={!stripe || paying}
          className="flex-1 flex items-center justify-center gap-2 py-4 bg-neon-pink text-black font-bold rounded-xl hover:bg-[#ff3399] transition-colors duration-200 uppercase tracking-wide border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {paying ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Processing…
            </>
          ) : (
            `Pay $${summary.total.toFixed(2)}`
          )}
        </button>
      </div>
    </div>
  );
};

// ─── Main Checkout page ────────────────────────────────────────────────────

const Checkout = () => {
  const navigate = useNavigate();
  const { cart, getCartTotal, getCartCount, clearCart, cartVendorId, cartEventId } = useCart();
  const { user } = useUser();

  const [fulfillmentType, setFulfillmentType] = useState('BOOTH_PICKUP');
  const [form, setForm] = useState({
    name: user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '',
    phone: user?.primaryPhoneNumber?.phoneNumber ?? '',
    // Curbside
    vehicleMake: '',
    vehicleColor: '',
    vehiclePlate: '',
    // Home delivery
    deliveryStreet: sessionStorage.getItem('deliveryAddress') || '',
    deliveryCity: '',
    deliveryZip: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [summary, setSummary] = useState(null);

  const cartTotal = getCartTotal();
  const cartCount = getCartCount();

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const validate = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error('Name and phone number are required');
      return false;
    }
    if (!cartVendorId || !cartEventId) {
      toast.error('Cart data is incomplete — please re-add items from the menu');
      return false;
    }
    if (fulfillmentType === 'CURBSIDE') {
      if (!form.vehicleMake.trim() || !form.vehicleColor.trim()) {
        toast.error('Vehicle make and color are required for curbside pickup');
        return false;
      }
    }
    if (fulfillmentType === 'HOME_DELIVERY') {
      if (!form.deliveryStreet.trim() || !form.deliveryCity.trim() || !form.deliveryZip.trim()) {
        toast.error('Full delivery address is required');
        return false;
      }
    }
    return true;
  };

  const handlePlaceOrder = async () => {
    if (!validate()) return;
    setSubmitting(true);

    try {
      const body = {
        vendorId: cartVendorId,
        eventId: cartEventId,
        fulfillmentType,
        items: cart.map(item => ({
          menuItemId: item.id,
          quantity: item.quantity,
          specialInstructions: item.specialInstructions ?? undefined,
        })),
        customerName: form.name.trim(),
        customerPhone: form.phone.trim(),
        ...(fulfillmentType === 'CURBSIDE' && {
          vehicleMake: form.vehicleMake.trim(),
          vehicleColor: form.vehicleColor.trim(),
          vehiclePlate: form.vehiclePlate.trim() || undefined,
        }),
        ...(fulfillmentType === 'HOME_DELIVERY' && {
          deliveryStreet: form.deliveryStreet.trim(),
          deliveryCity: form.deliveryCity.trim(),
          deliveryZip: form.deliveryZip.trim(),
        }),
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to create order');
        return;
      }

      setClientSecret(json.data.clientSecret);
      setOrderId(json.data.orderId);
      setSummary(json.data.summary);
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccess = useCallback(() => {
    toast.success('Order placed! 🎉');
    clearCart();
    navigate('/home');
  }, [clearCart, navigate]);

  if (cartCount === 0) {
    return (
      <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center pt-20 text-center px-4">
        <div className="text-5xl mb-4">🛒</div>
        <h2 className="font-bebas text-3xl text-white mb-2">Your cart is empty</h2>
        <p className="text-text-gray mb-6">Add some fair food before checking out.</p>
        <button onClick={() => navigate('/menu')} className="px-6 py-3 bg-neon-pink text-white font-bold rounded-xl hover:bg-[#e0006b] transition-colors">
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
          <button onClick={() => clientSecret ? setClientSecret(null) : navigate(-1)} className="p-2 hover:bg-white/5 rounded-lg transition-colors bg-transparent border-0 cursor-pointer">
            <ArrowLeftIcon className="w-5 h-5 text-white" />
          </button>
          <h1 className="font-bebas text-2xl tracking-wide text-white">
            {clientSecret ? 'Payment' : 'Checkout'}
          </h1>
        </div>
      </div>

      <div className="max-w-[75rem] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Left: Forms ── */}
          <div className="lg:col-span-2 space-y-6">

            {clientSecret ? (
              <Elements
                stripe={getStripe()}
                options={{
                  clientSecret,
                  appearance: {
                    theme: 'night',
                    variables: {
                      colorPrimary: '#FF0077',
                      colorBackground: '#0F0F0F',
                      colorText: '#ffffff',
                      borderRadius: '12px',
                    },
                  },
                }}
              >
                <PaymentStep
                  orderId={orderId}
                  summary={summary}
                  onBack={() => setClientSecret(null)}
                  onSuccess={handleSuccess}
                />
              </Elements>
            ) : (
              <>
                {/* Fulfillment Type */}
                <div className={sectionClass}>
                  <h2 className="font-bebas text-xl tracking-wide text-white mb-5">How would you like it?</h2>
                  <div className="space-y-3">
                    {FULFILLMENT_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setFulfillmentType(opt.value)}
                          className={`w-full p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${fulfillmentType === opt.value ? 'border-neon-pink bg-neon-pink/10' : 'border-white/10 bg-transparent hover:border-white/20'}`}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="w-5 h-5 text-white flex-shrink-0" />
                            <div>
                              <p className="text-white font-semibold text-sm">{opt.label}</p>
                              <p className="text-text-gray text-xs mt-0.5">{opt.sub}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Customer Info */}
                <div className={sectionClass}>
                  <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Your Info</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Full Name *</label>
                      <input type="text" name="name" value={form.name} onChange={handleChange} className={inputClass} placeholder="John Doe" />
                    </div>
                    <div>
                      <label className={labelClass}>Phone Number *</label>
                      <input type="tel" name="phone" value={form.phone} onChange={handleChange} className={inputClass} placeholder="(555) 123-4567" />
                    </div>
                  </div>
                </div>

                {/* Curbside fields */}
                {fulfillmentType === 'CURBSIDE' && (
                  <div className={sectionClass}>
                    <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Vehicle Info</h2>
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={labelClass}>Vehicle Make *</label>
                          <input type="text" name="vehicleMake" value={form.vehicleMake} onChange={handleChange} className={inputClass} placeholder="Toyota" />
                        </div>
                        <div>
                          <label className={labelClass}>Vehicle Color *</label>
                          <input type="text" name="vehicleColor" value={form.vehicleColor} onChange={handleChange} className={inputClass} placeholder="Silver" />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>License Plate <span className="text-text-gray font-normal normal-case">(optional)</span></label>
                        <input type="text" name="vehiclePlate" value={form.vehiclePlate} onChange={handleChange} className={inputClass} placeholder="ABC 1234" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Home delivery fields */}
                {fulfillmentType === 'HOME_DELIVERY' && (
                  <div className={sectionClass}>
                    <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Delivery Address</h2>
                    <div className="space-y-4">
                      <div>
                        <label className={labelClass}>Street Address *</label>
                        <input type="text" name="deliveryStreet" value={form.deliveryStreet} onChange={handleChange} className={inputClass} placeholder="147 E Grove Ave" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={labelClass}>City *</label>
                          <input type="text" name="deliveryCity" value={form.deliveryCity} onChange={handleChange} className={inputClass} placeholder="Springfield" />
                        </div>
                        <div>
                          <label className={labelClass}>ZIP Code *</label>
                          <input type="text" name="deliveryZip" value={form.deliveryZip} onChange={handleChange} className={inputClass} placeholder="62701" maxLength={10} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={handlePlaceOrder}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-neon-pink text-black font-bold rounded-xl hover:bg-[#ff3399] transition-colors duration-200 uppercase tracking-wide border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      Creating Order…
                    </>
                  ) : (
                    <>
                      Continue to Payment
                      <ArrowRightIcon className="w-4 h-4" />
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {/* ── Right: Order Summary ── */}
          <div className="lg:col-span-1">
            <div className="bg-bg-card border border-white/10 rounded-2xl p-6 sticky top-36">
              <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Order Summary</h2>

              <div className="space-y-3 mb-5 max-h-64 overflow-y-auto -mx-1 px-1">
                {cart.map(item => (
                  <div key={`${item.id}-${item.sizeName || ''}`} className="flex gap-3 pb-3 border-b border-white/5 last:border-0 last:pb-0">
                    {item.imageUrl || item.image ? (
                      <img src={item.imageUrl || item.image} alt={item.name} className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-bg-dark flex items-center justify-center flex-shrink-0 text-2xl">
                        {item.emoji ?? '🍽️'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{item.name}</p>
                      {item.vendorName && <p className="text-text-gray text-xs">{item.vendorName}</p>}
                      <p className="text-neon-pink font-bold text-sm mt-0.5">
                        {item.quantity} × ${item.price.toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2 pb-4 border-b border-white/10 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-gray">Subtotal</span>
                  <span className="text-white">${cartTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-gray">Fulfillment</span>
                  <span className="text-white capitalize">{FULFILLMENT_OPTIONS.find(o => o.value === fulfillmentType)?.label}</span>
                </div>
              </div>

              <div className="flex justify-between py-4">
                <span className="text-white font-bold">Est. Subtotal</span>
                <span className="text-neon-pink font-bold text-xl">${cartTotal.toFixed(2)}</span>
              </div>

              <p className="text-text-gray text-xs text-center">
                Final total confirmed at payment step
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Checkout;
