import React from 'react'

type AccentColor = 'pink' | 'blue' | 'emerald' | 'amber' | 'sky' | 'orange'

const ACCENTS: Record<AccentColor, { bg: string; border: string; text: string }> = {
  pink:    { bg: 'bg-neon-pink/10',   border: 'border-neon-pink/20',   text: 'text-neon-pink' },
  blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400' },
  sky:     { bg: 'bg-sky-500/10',     border: 'border-sky-500/20',     text: 'text-sky-400' },
  orange:  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-400' },
}

interface StatsCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  sub?: string
  accentColor?: AccentColor
  loading?: boolean
  className?: string
}

export function StatsCard({
  label, value, icon: Icon, sub, accentColor = 'pink', loading, className = '',
}: StatsCardProps) {
  const accent = ACCENTS[accentColor]
  return (
    <div className={`bg-bg-card border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all duration-300 ${className}`}>
      <div className="mb-4">
        <div className={`w-10 h-10 ${accent.bg} ${accent.border} border rounded-xl flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${accent.text}`} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse mb-1" />
      ) : (
        <div className="font-bebas text-[2rem] tracking-wide text-white leading-none mb-1">{value}</div>
      )}
      <div className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold">{label}</div>
      {sub && <div className="text-text-gray text-[0.625rem] mt-0.5">{sub}</div>}
    </div>
  )
}
