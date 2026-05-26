'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BuildingStorefrontIcon,
  TruckIcon,
  HomeIcon,
  ClockIcon,
  ShoppingCartIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useUser, useAuth } from '@clerk/clerk-react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { APIProvider } from '@vis.gl/react-google-maps'
import { getStripe } from '@/lib/stripe-client'
import { useFair } from '../../../_contexts/FairContext'
import { useFairCart } from '../../../_contexts/FairCartContext'
import AddressAutocomplete from '../../../_components/AddressAutocomplete'

// ─── Style constants ──────────────────────────────────────────────────────────

const inputClass =
  'w-full p-3 bg-[#0F0F0F] border border-white/10 rounded-xl text-white placeholder:text-[#A1A1A1] focus:border-[#FF0077] focus:outline-none transition-colors duration-200 text-sm'
const labelClass = 'block text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1.5'
const sectionClass = 'bg-[#1A1A1A] border border-white/10 rounded-2xl p-6'

// ─── Vehicle data ─────────────────────────────────────────────────────────────

const CAR_MAKES = [
  'Acura','Alfa Romeo','Aston Martin','Audi','Bentley','BMW','Buick',
  'Cadillac','Chevrolet','Chrysler','Dodge','Ferrari','Fiat','Ford',
  'Genesis','GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kia',
  'Lamborghini','Land Rover','Lexus','Lincoln','Maserati','Mazda',
  'McLaren','Mercedes-Benz','MINI','Mitsubishi','Nissan','Polestar',
  'Porsche','Ram','Rivian','Rolls-Royce','Subaru','Tesla','Toyota',
  'Volkswagen','Volvo','Other',
]

const CAR_COLORS = [
  'Black','White','Silver','Gray','Red','Blue','Green','Yellow',
  'Orange','Brown','Beige','Gold','Purple','Pink','Burgundy','Other',
]

const validatePlate = (plate: string) => {
  if (!plate) return true
  const cleaned = plate.replace(/[\s-]/g, '')
  return /^[A-Z0-9]{2,8}$/i.test(cleaned)
}

// ─── Fulfillment options ──────────────────────────────────────────────────────

const ALL_FULFILLMENT_OPTIONS = [
  { value: 'BOOTH_PICKUP',  label: 'Booth Pickup',  sub: 'Walk to the vendor booth', icon: BuildingStorefrontIcon },
  { value: 'CURBSIDE',      label: 'Curbside',       sub: 'We bring it to your car',  icon: TruckIcon },
  { value: 'HOME_DELIVERY', label: 'Home Delivery',  sub: 'Deliver to your address',  icon: HomeIcon },
]

// ─── Phone helpers ────────────────────────────────────────────────────────────

const validatePhone = (phone: string): boolean => {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
  return /^(\+1|1)?[2-9]\d{9}$/.test(cleaned)
}

const formatPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderSummary {
  subtotal: number
  deliveryFee?: number | null
  serviceCharge?: number | null
  fairSynqFee: number
  total: number
}

// ─── Stripe appearance ────────────────────────────────────────────────────────

const stripeAppearance = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#FF0077',
    colorBackground: '#0F0F0F',
    colorText: '#ffffff',
    borderRadius: '12px',
  },
}

// ─── Payment step (must be rendered inside <Elements>) ────────────────────────

interface PaymentStepProps {
  orderId: string
  fairSlug: string
  summary: OrderSummary
  onBack: () => void
  onSuccess: () => void
}

function PaymentStep({ orderId, fairSlug, summary, onBack, onSuccess }: PaymentStepProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const payingRef = useRef(false)

  const total = summary.total + summary.fairSynqFee

  const handlePay = async () => {
    if (!stripe || !elements || payingRef.current) return
    payingRef.current = true
    setPaying(true)
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/fair/${fairSlug}/order/${orderId.slice(-8).toUpperCase()}`,
        },
        redirect: 'if_required',
      })

      if (error) {
        toast.error(error.message ?? 'Payment failed — please try again')
        return
      }

      if (paymentIntent?.status === 'succeeded') {
        // Mark order PLACED (client-side fallback; webhook also handles this)
        await fetch(`/api/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'PLACED' }),
        }).catch(() => {})
        onSuccess()
      }
    } catch {
      toast.error('Something went wrong — please try again')
    } finally {
      payingRef.current = false
      setPaying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className={sectionClass}>
        <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Payment</h2>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      <div className={sectionClass}>
        <h2 className="font-bebas text-xl tracking-wide text-white mb-4">Order Total</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#A1A1A1]">Subtotal</span>
            <span className="text-white">${(summary.subtotal ?? 0).toFixed(2)}</span>
          </div>
          {summary.deliveryFee != null && summary.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span className="text-[#A1A1A1]">Delivery Fee</span>
              <span className="text-white">${(summary.deliveryFee ?? 0).toFixed(2)}</span>
            </div>
          )}
          {summary.serviceCharge != null && summary.serviceCharge > 0 && (
            <div className="flex justify-between">
              <span className="text-[#A1A1A1]">Event service charge</span>
              <span className="text-white">${(summary.serviceCharge ?? 0).toFixed(2)}</span>
            </div>
          )}
          {summary.fairSynqFee > 0 && (
            <div className="flex justify-between">
              <span className="text-[#A1A1A1]">Platform Fee</span>
              <span className="text-white">${(summary.fairSynqFee ?? 0).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between pt-3 border-t border-white/10">
            <span className="text-white font-bold">Total</span>
            <span className="text-[#FF0077] font-bold text-xl">${(total ?? 0).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handlePay}
          disabled={!stripe || paying}
          className="flex-1 flex items-center justify-center gap-2 py-4 bg-[#FF0077] text-black font-bold rounded-xl hover:bg-[#ff3399] transition-colors duration-200 uppercase tracking-wide border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {paying ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Processing…
            </>
          ) : (
            `Pay $${(total ?? 0).toFixed(2)}`
          )}
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter()
  const params = useParams<{ fairSlug: string }>()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { fair, fairLoading } = useFair()
  const { items, itemCount, subtotal, clearCart } = useFairCart()
  const { user } = useUser()

  // Redirect unauthenticated users to sign-in with a return URL
  useEffect(() => {
    if (authLoaded && !isSignedIn) {
      router.replace(
        `/sign-in?redirect_url=${encodeURIComponent(`/fair/${params.fairSlug}/checkout`)}`
      )
    }
  }, [authLoaded, isSignedIn, params.fairSlug, router])

  type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

  const fc = fair.fulfillmentConfig
  const fulfillmentOptions = ALL_FULFILLMENT_OPTIONS.filter(opt => {
    if (opt.value === 'CURBSIDE' && fc && !fc.curbsideEnabled) return false
    if (opt.value === 'HOME_DELIVERY' && fc && !fc.homeDeliveryEnabled) return false
    return true
  })

  const configDeliveryFee = fc?.homeDeliveryFee ?? 2.99
  const serviceChargeAmount = fair.serviceChargeEnabled && fair.serviceChargeAmount
    ? fair.serviceChargeAmount
    : 0

  // ── Form state ──────────────────────────────────────────────────────────────
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('BOOTH_PICKUP')
  const [form, setForm] = useState({
    name: user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '',
    phone: '',
    vehicleMake: '',
    vehicleColor: '',
    vehiclePlate: '',
    deliveryStreet: '',
    deliveryCity: '',
    deliveryZip: '',
  })

  useEffect(() => {
    if (user && !form.name) {
      setForm(prev => ({
        ...prev,
        name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      }))
    }
  }, [user])

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [orderShortId, setOrderShortId] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null)

  const hasOrder = orderId !== null && clientSecret !== null

  // Platform fee estimate (before order creation)
  const [platformFeeRate, setPlatformFeeRate] = useState(0.10)
  const primaryVendorId = items[0]?.vendorId ?? null

  useEffect(() => {
    if (!primaryVendorId) return
    fetch(`/api/vendors/${primaryVendorId}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.commissionRate != null) {
          setPlatformFeeRate(Number(json.data.commissionRate))
        }
      })
      .catch(() => {})
  }, [primaryVendorId])

  const estimatedDeliveryFee = fulfillmentType === 'HOME_DELIVERY' ? configDeliveryFee : 0
  const estimatedPlatformFee = Math.round(subtotal * platformFeeRate * 100) / 100
  const estimatedTotal = parseFloat((subtotal + estimatedDeliveryFee + serviceChargeAmount + estimatedPlatformFee).toFixed(2))

  const estimatedReadyMin = useMemo(() => {
    const times = items.map(i => i.prepTime).filter((t): t is number => t != null)
    return times.length > 0 ? Math.max(...times) : null
  }, [items])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handlePlaceSelect = (place: google.maps.places.PlaceResult) => {
    const comps = place.address_components ?? []
    const get = (type: string) => comps.find(c => c.types.includes(type))?.long_name ?? ''
    setForm(prev => ({
      ...prev,
      deliveryStreet: place.formatted_address ?? prev.deliveryStreet,
      deliveryCity: get('locality') || get('sublocality') || get('administrative_area_level_2'),
      deliveryZip: get('postal_code'),
    }))
  }

  const validate = () => {
    if (!form.name.trim()) {
      toast.error('Full name is required')
      return false
    }
    if (!validatePhone(form.phone)) {
      setFieldErrors(prev => ({ ...prev, phone: 'Enter a valid 10-digit US phone number' }))
      return false
    }
    if (fairLoading) {
      toast.error('Still loading event data — please wait a moment')
      return false
    }
    if (!fair.id) {
      toast.error('Cart data is incomplete — please re-add items from the menu')
      return false
    }
    if (fulfillmentType === 'CURBSIDE') {
      const errs: Partial<Record<string, string>> = {}
      if (!form.vehicleMake) errs.vehicleMake = 'Please select your vehicle make'
      if (!form.vehicleColor) errs.vehicleColor = 'Please select your vehicle color'
      if (form.vehiclePlate && !validatePlate(form.vehiclePlate)) {
        errs.vehiclePlate = 'Enter a valid plate (2–8 letters/numbers)'
      }
      if (Object.keys(errs).length > 0) {
        setFieldErrors(errs)
        return false
      }
    }
    setFieldErrors({})
    if (fulfillmentType === 'HOME_DELIVERY' && !form.deliveryStreet.trim()) {
      toast.error('Delivery address is required')
      return false
    }
    return true
  }

  const handlePlaceOrder = async () => {
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(`/fair/${params.fairSlug}/checkout`)}`)
      return
    }
    if (!validate()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: fair.id,
          fulfillmentType,
          customerName: form.name.trim(),
          customerPhone: form.phone.trim(),
          items: items.map(i => ({
            menuItemId: i.menuItemId,
            vendorId: i.vendorId,
            quantity: i.quantity,
          })),
          ...(fulfillmentType === 'CURBSIDE' && {
            vehicleMake: form.vehicleMake,
            vehicleColor: form.vehicleColor,
            vehiclePlate: form.vehiclePlate || undefined,
          }),
          ...(fulfillmentType === 'HOME_DELIVERY' && {
            deliveryStreet: form.deliveryStreet.trim(),
            deliveryCity: form.deliveryCity.trim() || form.deliveryStreet.trim(),
            deliveryZip: form.deliveryZip.trim() || '00000',
          }),
        }),
      })

      const json = await res.json()
      if (!json.success) {
        toast.error('Failed to create order — please try again')
        return
      }

      setOrderId(json.data.orderId)
      setOrderShortId(json.data.shortId ?? json.data.orderId.slice(-8).toUpperCase())
      setClientSecret(json.data.clientSecret)
      setOrderSummary(json.data.summary)
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSuccess = useCallback(() => {
    toast.success('Order placed!')
    clearCart()
    router.push(`/fair/${params.fairSlug}/order/${orderShortId ?? orderId}`)
  }, [clearCart, router, params.fairSlug, orderId, orderShortId])

  // ── Auth guard — show skeleton while redirecting unauthenticated users ──────
  if (!authLoaded || !isSignedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="w-8 h-8 border-2 border-[#FF0077] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#A1A1A1] text-sm">Checking sign-in…</p>
      </div>
    )
  }

  // ── Empty cart guard ────────────────────────────────────────────────────────
  if (itemCount === 0 && !hasOrder) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
        <ShoppingCartIcon className="w-16 h-16 mb-4 mx-auto text-white/20" />
        <h2 className="font-bebas text-3xl text-white mb-2">Your cart is empty</h2>
        <p className="text-[#A1A1A1] mb-6">Add some fair food before checking out.</p>
        <button
          onClick={() => router.push(`/fair/${params.fairSlug}/vendors`)}
          className="px-6 py-3 bg-[#FF0077] text-white font-bold rounded-xl hover:bg-[#e0006b] transition-colors"
        >
          Browse Vendors
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-12">
      {/* Step header */}
      <div className="sticky top-14 sm:top-16 z-10 bg-[#0F0F0F]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[75rem] mx-auto px-5 sm:px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => hasOrder ? (setOrderId(null), setClientSecret(null)) : router.back()}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
          >
            <ArrowLeftIcon className="w-5 h-5 text-white" />
          </button>
          <h1 className="font-bebas text-2xl tracking-wide text-white">
            {hasOrder ? 'Payment' : 'Checkout'}
          </h1>
        </div>
      </div>

      <div className="max-w-[75rem] mx-auto px-5 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Left: forms ─────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            {hasOrder && clientSecret && orderSummary ? (
              <Elements
                stripe={getStripe()}
                options={{ clientSecret, appearance: stripeAppearance }}
              >
                <PaymentStep
                  orderId={orderId!}
                  fairSlug={params.fairSlug}
                  summary={orderSummary}
                  onBack={() => { setOrderId(null); setClientSecret(null) }}
                  onSuccess={handleSuccess}
                />
              </Elements>
            ) : (
              <>
                {/* Fulfillment type */}
                {fulfillmentOptions.length > 1 && (
                  <div className={sectionClass}>
                    <h2 className="font-bebas text-xl tracking-wide text-white mb-5">How would you like it?</h2>
                    <div className="space-y-3">
                      {fulfillmentOptions.map(opt => {
                        const Icon = opt.icon
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setFulfillmentType(opt.value as FulfillmentType)}
                            className={`w-full p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${
                              fulfillmentType === opt.value
                                ? 'border-[#FF0077] bg-[#FF0077]/10'
                                : 'border-white/10 bg-transparent hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className="w-5 h-5 text-white flex-shrink-0" />
                              <div>
                                <p className="text-white font-semibold text-sm">{opt.label}</p>
                                <p className="text-[#A1A1A1] text-xs mt-0.5">
                                  {opt.value === 'HOME_DELIVERY'
                                    ? `${opt.sub} — $${(configDeliveryFee ?? 0).toFixed(2)} fee`
                                    : opt.sub}
                                </p>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Customer info */}
                <div className={sectionClass}>
                  <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Your Info</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Full Name *</label>
                      <input type="text" name="name" value={form.name} onChange={handleChange} className={inputClass} placeholder="John Doe" />
                    </div>
                    <div>
                      <label className={labelClass}>Phone Number *</label>
                      <input
                        type="tel"
                        name="phone"
                        value={form.phone}
                        inputMode="tel"
                        placeholder="(618) 555-1234"
                        onChange={e => {
                          setForm(prev => ({ ...prev, phone: formatPhone(e.target.value) }))
                          setFieldErrors(prev => ({ ...prev, phone: undefined }))
                        }}
                        onBlur={() => {
                          if (form.phone && !validatePhone(form.phone)) {
                            setFieldErrors(prev => ({ ...prev, phone: 'Enter a valid 10-digit US phone number' }))
                          }
                        }}
                        className={`${inputClass} ${fieldErrors.phone ? 'border-red-500 focus:border-red-500' : ''}`}
                      />
                      {fieldErrors.phone && <p className="mt-1 text-xs text-red-400">{fieldErrors.phone}</p>}
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
                          <select
                            name="vehicleMake" value={form.vehicleMake}
                            onChange={e => { setForm(prev => ({ ...prev, vehicleMake: e.target.value })); setFieldErrors(prev => ({ ...prev, vehicleMake: undefined })) }}
                            className={`${inputClass} appearance-none ${fieldErrors.vehicleMake ? 'border-red-500 focus:border-red-500' : ''}`}
                          >
                            <option value="">Select make…</option>
                            {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                          {fieldErrors.vehicleMake && <p className="mt-1 text-xs text-red-400">{fieldErrors.vehicleMake}</p>}
                        </div>
                        <div>
                          <label className={labelClass}>Vehicle Color *</label>
                          <select
                            name="vehicleColor" value={form.vehicleColor}
                            onChange={e => { setForm(prev => ({ ...prev, vehicleColor: e.target.value })); setFieldErrors(prev => ({ ...prev, vehicleColor: undefined })) }}
                            className={`${inputClass} appearance-none ${fieldErrors.vehicleColor ? 'border-red-500 focus:border-red-500' : ''}`}
                          >
                            <option value="">Select color…</option>
                            {CAR_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          {fieldErrors.vehicleColor && <p className="mt-1 text-xs text-red-400">{fieldErrors.vehicleColor}</p>}
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>
                          License Plate{' '}
                          <span className="text-[#A1A1A1] font-normal normal-case">(optional)</span>
                        </label>
                        <input
                          type="text" name="vehiclePlate"
                          value={form.vehiclePlate}
                          onChange={e => {
                            const val = e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, '')
                            setForm(prev => ({ ...prev, vehiclePlate: val }))
                            setFieldErrors(prev => ({ ...prev, vehiclePlate: undefined }))
                          }}
                          maxLength={10}
                          className={`${inputClass} ${fieldErrors.vehiclePlate ? 'border-red-500 focus:border-red-500' : ''}`}
                          placeholder="ABC 1234"
                        />
                        {fieldErrors.vehiclePlate && <p className="mt-1 text-xs text-red-400">{fieldErrors.vehiclePlate}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Home delivery fields */}
                {fulfillmentType === 'HOME_DELIVERY' && (
                  <div className={sectionClass}>
                    <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Delivery Address</h2>
                    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''}>
                      <div>
                        <label className={labelClass}>Street Address *</label>
                        <div className="bg-[#0F0F0F] border border-white/10 rounded-xl focus-within:border-[#FF0077] transition-colors">
                          <AddressAutocomplete
                            value={form.deliveryStreet}
                            onChange={val => setForm(prev => ({ ...prev, deliveryStreet: val }))}
                            onPlaceSelect={handlePlaceSelect}
                          />
                        </div>
                      </div>
                    </APIProvider>
                  </div>
                )}

                <button
                  onClick={handlePlaceOrder}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-[#FF0077] text-black font-bold rounded-xl hover:bg-[#ff3399] transition-colors duration-200 uppercase tracking-wide border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* ── Right: order summary ────────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 lg:sticky lg:top-36">
              <h2 className="font-bebas text-xl tracking-wide text-white mb-5">Order Summary</h2>

              <div className="space-y-3 mb-5 max-h-64 overflow-y-auto -mx-1 px-1">
                {items.map(item => (
                  <div key={item.menuItemId} className="flex gap-3 pb-3 border-b border-white/5 last:border-0 last:pb-0">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-[#0F0F0F] flex items-center justify-center flex-shrink-0">
                        <BuildingStorefrontIcon className="w-6 h-6 text-white/20" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{item.name}</p>
                      {item.vendorName && <p className="text-[#A1A1A1] text-xs">{item.vendorName}</p>}
                      <p className="text-[#FF0077] font-bold text-sm mt-0.5">
                        {item.quantity} × ${(item.price ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {estimatedReadyMin && (
                <div className="flex items-center gap-2 py-3 px-3 mb-4 bg-white/[0.03] border border-white/5 rounded-xl">
                  <ClockIcon className="w-4 h-4 text-[#FF0077] flex-shrink-0" />
                  <span className="text-[#A1A1A1] text-xs">
                    Ready in ~<span className="text-white font-semibold">{estimatedReadyMin} min</span>
                  </span>
                </div>
              )}

              <div className="space-y-2 pb-4 border-b border-white/10 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#A1A1A1]">Subtotal</span>
                  <span className="text-white">${(orderSummary?.subtotal ?? subtotal).toFixed(2)}</span>
                </div>
                {fulfillmentType === 'HOME_DELIVERY' && (
                  <div className="flex justify-between">
                    <span className="text-[#A1A1A1]">Delivery Fee</span>
                    <span className="text-white">${(orderSummary?.deliveryFee ?? configDeliveryFee).toFixed(2)}</span>
                  </div>
                )}
                {serviceChargeAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#A1A1A1]">Event service charge</span>
                    <span className="text-white">${(serviceChargeAmount ?? 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#A1A1A1]">Platform Fee</span>
                  <span className="text-white">
                    ${(orderSummary?.fairSynqFee ?? estimatedPlatformFee).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex justify-between py-4">
                <span className="text-white font-bold">
                  {orderSummary ? 'Total' : 'Est. Total'}
                </span>
                <span className="text-[#FF0077] font-bold text-xl">
                  ${orderSummary
                    ? (orderSummary.total + orderSummary.fairSynqFee).toFixed(2)
                    : (estimatedTotal ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
