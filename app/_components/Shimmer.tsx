'use client'

interface ShimmerProps {
  className?: string
}

export function Shimmer({ className = '' }: ShimmerProps) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-white/[0.06] ${className}`}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
    </div>
  )
}

export function ShimmerCard({ className = '' }: ShimmerProps) {
  return (
    <div className={`bg-bg-card border border-white/10 rounded-2xl p-5 space-y-3 ${className}`}>
      <Shimmer className="h-4 w-2/5 rounded-lg" />
      <Shimmer className="h-8 w-3/5 rounded-lg" />
      <Shimmer className="h-3 w-4/5 rounded-lg" />
    </div>
  )
}

export function ShimmerText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  const widths = ['w-full', 'w-4/5', 'w-3/5', 'w-2/3', 'w-1/2']
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Shimmer key={i} className={`h-3.5 ${widths[i % widths.length]} rounded-md`} />
      ))}
    </div>
  )
}

export function ShimmerAvatar({ size = 10 }: { size?: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-full bg-white/[0.06] shrink-0"
      style={{ width: `${size * 4}px`, height: `${size * 4}px` }}
    >
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
    </div>
  )
}

export function ShimmerRow({ className = '' }: ShimmerProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <ShimmerAvatar size={9} />
      <div className="flex-1 space-y-2">
        <Shimmer className="h-3.5 w-2/5 rounded-md" />
        <Shimmer className="h-3 w-3/5 rounded-md" />
      </div>
    </div>
  )
}
