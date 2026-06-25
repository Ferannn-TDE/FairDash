'use client'

import { useState } from 'react'
import { User, Phone, Mail, Car, Bell, Clock, LogOut, ChevronRight, Wallet } from 'lucide-react'
import StripeConnectCard from '../../../_components/StripeConnectCard'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function RunnerSettingsPage() {
  const [name, setName] = useState('Alex Rivera')
  const [phone, setPhone] = useState('+1 312-555-0177')
  const [email] = useState('alex.rivera@email.com')
  const [vehicleMake, setVehicleMake] = useState('Honda')
  const [vehicleModel, setVehicleModel] = useState('Civic')
  const [vehicleColor, setVehicleColor] = useState('Blue')
  const [vehiclePlate, setVehiclePlate] = useState('LMN 9012')
  const [notifications, setNotifications] = useState({
    newDelivery: true,
    orderUpdates: true,
    earnings: false,
  })
  const [availability, setAvailability] = useState<Record<string, boolean>>(
    Object.fromEntries(DAYS.map((d) => [d, ['Fri', 'Sat', 'Sun'].includes(d)]))
  )
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 sm:py-8 space-y-5">

      <h1 className="font-bebas text-[clamp(1.75rem,5vw,2.5rem)] tracking-wide text-white leading-tight">
        Runner <span className="text-neon-pink">Settings</span>
      </h1>

      {/* Profile */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <User className="w-3.5 h-3.5" /> Profile
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">
              Full Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors"
            />
          </div>
          <div>
            <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">
              Phone
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-bg-dark border border-white/10 rounded-xl pl-9 pr-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
              <input
                value={email}
                readOnly
                className="w-full bg-white/[0.03] border border-white/5 rounded-xl pl-9 pr-4 py-3 text-text-gray text-sm outline-none cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle info */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Car className="w-3.5 h-3.5" /> Vehicle Info
        </p>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Make', value: vehicleMake, set: setVehicleMake },
            { label: 'Model', value: vehicleModel, set: setVehicleModel },
            { label: 'Color', value: vehicleColor, set: setVehicleColor },
            { label: 'Plate', value: vehiclePlate, set: setVehiclePlate },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">
                {label}
              </label>
              <input
                value={value}
                onChange={(e) => set(e.target.value)}
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-neon-pink transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" /> Notifications
        </p>

        <div className="space-y-3">
          {[
            { key: 'newDelivery' as const, label: 'New delivery requests', sub: 'Alert when a delivery is assigned' },
            { key: 'orderUpdates' as const, label: 'Order updates', sub: 'Status changes on your active delivery' },
            { key: 'earnings' as const, label: 'Earnings summary', sub: 'Daily earnings recap' },
          ].map(({ key, label, sub }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-semibold">{label}</p>
                <p className="text-text-gray text-xs">{sub}</p>
              </div>
              <button
                onClick={() => setNotifications((prev) => ({ ...prev, [key]: !prev[key] }))}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer border-0 shrink-0 ${
                  notifications[key] ? 'bg-neon-pink' : 'bg-white/10'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  notifications[key] ? 'left-5' : 'left-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Availability */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" /> Availability
        </p>
        <p className="text-text-gray text-xs -mt-2">Select days you&apos;re available to run deliveries.</p>

        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => (
            <button
              key={day}
              onClick={() => setAvailability((prev) => ({ ...prev, [day]: !prev[day] }))}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                availability[day]
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Payouts */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5" /> Payouts
        </p>
        <StripeConnectCard
          basePath="/api/runners/me/stripe"
          description="Connect a Stripe account to receive your delivery earnings from FairSynq."
        />
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all border-0 cursor-pointer ${
          saved
            ? 'bg-emerald-500 text-white'
            : 'bg-neon-pink text-white hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)]'
        }`}
      >
        {saved ? 'Saved!' : 'Save Changes'}
      </button>

      {/* Sign out */}
      <button className="w-full py-3.5 bg-white/5 border border-white/10 text-red-400 rounded-xl font-semibold text-sm hover:bg-red-500/10 hover:border-red-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer">
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>

    </div>
  )
}
