'use client'

import { useState } from 'react'
import Link from 'next/link'
import { TruckIcon, CheckIcon, ChevronRightIcon, ChevronLeftIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import MarketplaceNavbar from '../_components/MarketplaceNavbar'

const STEPS = [
  { id: 1, label: 'Personal Info' },
  { id: 2, label: 'Vehicle Info' },
  { id: 3, label: 'Terms' },
]

const DRIVER_TERMS = `FAIRSYNQ DRIVER AGREEMENT

Last Updated: January 1, 2026

This Driver Agreement ("Agreement") is between FairSynq LLC ("FairSynq") and you ("Driver"). By completing this application, you agree to the terms below in full.

1. DRIVER ELIGIBILITY
To drive for FairSynq you must: (a) be at least 18 years of age; (b) hold a valid U.S. driver's license; (c) own or have authorized access to a vehicle in safe, roadworthy condition; (d) consent to a background check and motor vehicle record review; and (e) carry valid auto insurance meeting state minimums. FairSynq reserves the right to reject or terminate any driver application based on background check results.

2. INDEPENDENT CONTRACTOR STATUS
You acknowledge that you are an independent contractor, not an employee of FairSynq. You are responsible for all taxes, insurance, and expenses related to your work. FairSynq does not provide workers' compensation, health insurance, or other employee benefits. You may work for other platforms and set your own schedule, subject to fair event availability.

3. PAY & EARNINGS
Drivers earn a base delivery fee per completed order plus 100% of customer tips. The base fee varies by delivery distance, typically $3.00–$6.00 per order. Pay is deposited weekly via ACH direct deposit. FairSynq may offer bonuses during peak periods at its discretion.

4. VEHICLE REQUIREMENTS
Your vehicle must: (a) pass a visual inspection if requested by FairSynq; (b) be clean and free of strong odors that could affect food; (c) have functional heat and air conditioning for appropriate food temperature maintenance; and (d) display no offensive or inappropriate markings. Bicycles and electric scooters may be approved for designated zones.

5. DELIVERY STANDARDS
You agree to: (a) pick up orders promptly from vendors and deliver within the estimated time displayed to customers; (b) handle all food packages with care to prevent spills, damage, or contamination; (c) communicate professionally with vendors and customers; and (d) maintain a customer rating of at least 4.0 stars. Repeated late deliveries or low ratings may result in account suspension.

6. BACKGROUND CHECK CONSENT
By submitting this application, you expressly authorize FairSynq and its designated background check provider to obtain a consumer report including criminal history, motor vehicle records, and identity verification. You have the right to request a copy of any report obtained and to dispute inaccurate information.

7. SAFETY & CONDUCT
Drivers must comply with all traffic laws at all times while making deliveries. FairSynq has a zero-tolerance policy for: (a) driving under the influence of alcohol or substances; (b) verbal or physical altercations with customers or vendors; (c) theft or tampering with orders. Violations may result in immediate termination and referral to law enforcement.

8. TERMINATION
Either party may end this Agreement at any time. FairSynq may terminate immediately for safety violations, fraud, or conduct that harms the FairSynq brand. Any earned, unpaid balance will be paid at the next regular pay cycle.

9. LIMITATION OF LIABILITY
FairSynq's liability for any claim shall not exceed the total earnings paid to you in the 30 days preceding the claim. FairSynq is not liable for vehicle damage, personal injury, or other losses arising from your delivery activities.

10. GOVERNING LAW
This Agreement is governed by the laws of the State of Illinois. Disputes shall be resolved by binding arbitration in Sangamon County, IL.

By checking "I agree to the Driver Terms & Conditions," you confirm that you have read, understood, and agree to this Agreement in full, including consent to a background check.`

// Version identifier for DRIVER_TERMS (its "Last Updated" date). Sent with the
// application so the consent record captures WHICH terms were agreed to. Bump this
// whenever DRIVER_TERMS changes.
const DRIVER_TERMS_VERSION = '2026-01-01'

interface Personal {
  firstName: string; lastName: string; email: string
  phone: string; dob: string; city: string
}
interface Vehicle {
  make: string; model: string; year: string
  color: string; plate: string; type: string
}

export default function BecomeDriverPage() {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [bgConsent, setBgConsent] = useState(false)

  const [personal, setPersonal] = useState<Personal>({
    firstName: '', lastName: '', email: '', phone: '', dob: '', city: '',
  })
  const [vehicle, setVehicle] = useState<Vehicle>({
    make: '', model: '', year: '', color: '', plate: '', type: '',
  })

  const canProceedStep1 =
    personal.firstName.trim() && personal.lastName.trim() &&
    personal.email.trim() && personal.phone.trim() && personal.dob

  const canProceedStep2 =
    vehicle.make.trim() && vehicle.model.trim() &&
    vehicle.year.trim() && vehicle.type

  const canProceedStep3 = agreed && bgConsent

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personal, vehicle, agreed, bgConsent, termsVersion: DRIVER_TERMS_VERSION }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Submission failed')
      setStep(4)
      toast.success("Application submitted! We'll be in touch within 2–3 business days.")
    } catch (err: any) {
      toast.error(err.message || 'Could not submit application')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white pb-16">
        <div className="max-w-[700px] mx-auto px-[6%] md:px-5 py-10">

          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-neon-pink/10 border border-neon-pink/20 rounded-2xl mb-4">
              <TruckIcon className="w-8 h-8 text-neon-pink" />
            </div>
            <h1 className="font-bebas text-[clamp(2rem,5vw,3.5rem)] tracking-wide mb-2">
              Become a <span className="text-neon-pink">Driver</span>
            </h1>
            <p className="text-text-gray text-base">
              Deliver fair food and earn on your own schedule.
            </p>
          </div>

          {/* Progress Bar */}
          {step < 4 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                {STEPS.map((s, i) => (
                  <div key={s.id} className="flex items-center flex-1">
                    <div className="flex flex-col items-center w-full">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 border-2 ${
                        step > s.id
                          ? 'bg-neon-pink border-neon-pink text-white'
                          : step === s.id
                          ? 'border-neon-pink text-neon-pink bg-neon-pink/10'
                          : 'border-white/20 text-text-gray bg-white/5'
                      }`}>
                        {step > s.id ? <CheckIcon className="w-4 h-4" /> : s.id}
                      </div>
                      <span className={`text-[0.625rem] uppercase tracking-wide mt-1 font-semibold hidden sm:block text-center ${step >= s.id ? 'text-white' : 'text-text-gray'}`}>
                        {s.label}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-2 transition-colors duration-300 ${step > s.id ? 'bg-neon-pink' : 'bg-white/10'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Personal Info */}
          {step === 1 && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-7">
              <h2 className="font-bebas text-2xl tracking-wide mb-6 text-white">Personal Information</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      First Name <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="text"
                      value={personal.firstName}
                      onChange={(e) => setPersonal(p => ({ ...p, firstName: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Last Name <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="text"
                      value={personal.lastName}
                      onChange={(e) => setPersonal(p => ({ ...p, lastName: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="Last name"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Email <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="email"
                      value={personal.email}
                      onChange={(e) => setPersonal(p => ({ ...p, email: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Phone Number <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="tel"
                      value={personal.phone}
                      onChange={(e) => setPersonal(p => ({ ...p, phone: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="(555) 000-0000"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Date of Birth <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="date"
                      value={personal.dob}
                      onChange={(e) => setPersonal(p => ({ ...p, dob: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      City / Area
                    </label>
                    <input
                      type="text"
                      value={personal.city}
                      onChange={(e) => setPersonal(p => ({ ...p, city: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="Springfield, IL"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Vehicle Info */}
          {step === 2 && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-7">
              <h2 className="font-bebas text-2xl tracking-wide mb-6 text-white">Vehicle Information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                    Vehicle Type <span className="text-neon-pink">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {['Car', 'SUV / Truck', 'Motorcycle', 'Bicycle', 'Electric Scooter'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setVehicle(v => ({ ...v, type: t }))}
                        className={`px-4 py-2 rounded-full text-sm font-medium border cursor-pointer transition-all duration-200 ${
                          vehicle.type === t
                            ? 'bg-neon-pink border-neon-pink text-white'
                            : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Make <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="text"
                      value={vehicle.make}
                      onChange={(e) => setVehicle(v => ({ ...v, make: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="Toyota"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Model <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="text"
                      value={vehicle.model}
                      onChange={(e) => setVehicle(v => ({ ...v, model: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="Camry"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Year <span className="text-neon-pink">*</span>
                    </label>
                    <input
                      type="text"
                      value={vehicle.year}
                      onChange={(e) => setVehicle(v => ({ ...v, year: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="2020"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      Color
                    </label>
                    <input
                      type="text"
                      value={vehicle.color}
                      onChange={(e) => setVehicle(v => ({ ...v, color: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="Silver"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                      License Plate
                    </label>
                    <input
                      type="text"
                      value={vehicle.plate}
                      onChange={(e) => setVehicle(v => ({ ...v, plate: e.target.value }))}
                      className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                      placeholder="ABC 1234"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Terms */}
          {step === 3 && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-7">
              <h2 className="font-bebas text-2xl tracking-wide mb-2 text-white">Terms & Conditions</h2>
              <p className="text-text-gray text-sm mb-4">Please read the full driver agreement before proceeding.</p>
              <div className="h-64 overflow-y-auto bg-bg-dark border border-white/10 rounded-xl p-5 mb-5 text-text-gray text-[0.8125rem] leading-relaxed whitespace-pre-line">
                {DRIVER_TERMS}
              </div>
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <button
                    onClick={() => setAgreed(a => !a)}
                    className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all duration-200 cursor-pointer bg-transparent ${
                      agreed ? 'bg-neon-pink border-neon-pink' : 'border-white/20 group-hover:border-white/40'
                    }`}
                  >
                    {agreed && <CheckIcon className="w-3 h-3 text-white" />}
                  </button>
                  <span className="text-sm text-text-gray leading-relaxed">
                    I have read and agree to the{' '}
                    <span className="text-neon-pink font-semibold">Driver Terms & Conditions</span>{' '}
                    and understand my status as an independent contractor.
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <button
                    onClick={() => setBgConsent(c => !c)}
                    className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all duration-200 cursor-pointer bg-transparent ${
                      bgConsent ? 'bg-neon-pink border-neon-pink' : 'border-white/20 group-hover:border-white/40'
                    }`}
                  >
                    {bgConsent && <CheckIcon className="w-3 h-3 text-white" />}
                  </button>
                  <span className="text-sm text-text-gray leading-relaxed">
                    I consent to a{' '}
                    <span className="text-neon-pink font-semibold">background check and motor vehicle record review</span>{' '}
                    as a condition of my driver application.
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center">
              <div className="w-20 h-20 bg-neon-pink/10 border border-neon-pink/30 rounded-full flex items-center justify-center mx-auto mb-5">
                <CheckIcon className="w-10 h-10 text-neon-pink" />
              </div>
              <h2 className="font-bebas text-[2rem] tracking-wide text-white mb-2">Application Submitted!</h2>
              <p className="text-text-gray text-base mb-2">
                Thanks for applying to drive for FairSynq,{' '}
                <strong className="text-white">{personal.firstName || 'Driver'}</strong>.
              </p>
              <p className="text-text-gray text-sm mb-8">
                We'll review your application and reach out to{' '}
                <span className="text-neon-pink">{personal.email}</span>{' '}
                within 2–3 business days. A background check will be initiated shortly.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href="/fairs"
                  className="px-8 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
                >
                  Browse Fairs
                </Link>
                <Link
                  href="/"
                  className="px-8 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all"
                >
                  Go Home
                </Link>
              </div>
            </div>
          )}

          {/* Navigation */}
          {step < 4 && (
            <div className="flex justify-between mt-6">
              {step > 1 ? (
                <button
                  onClick={() => setStep(s => s - 1)}
                  className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all cursor-pointer"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <Link
                  href="/"
                  className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-text-gray rounded-xl font-semibold text-sm hover:bg-white/10 transition-all"
                >
                  Cancel
                </Link>
              )}

              {step < 3 ? (
                <button
                  onClick={() => setStep(s => s + 1)}
                  disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                  className="flex items-center gap-2 px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink"
                >
                  Next
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canProceedStep3 || submitting}
                  className="flex items-center gap-2 px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink"
                >
                  {submitting ? 'Submitting…' : 'Submit Application'}
                  {!submitting && <CheckIcon className="w-4 h-4" />}
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  )
}
