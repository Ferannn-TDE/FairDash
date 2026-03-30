/**
 * Reusable skeleton primitive components.
 * All accept a className prop for size/layout overrides.
 * Use inside an animate-pulse wrapper for the shimmer effect.
 */

interface SkeletonProps {
  className?: string
}

/** Rectangular block placeholder — for images, banners, buttons */
export function SkeletonBlock({ className = '' }: SkeletonProps) {
  return <div className={`bg-white/[0.08] rounded-xl ${className}`} />
}

/** Circular placeholder — for avatars, icons, badges */
export function SkeletonCircle({ className = '' }: SkeletonProps) {
  return <div className={`bg-white/[0.08] rounded-full ${className}`} />
}

/** Single-line text placeholder — h-4 default (body), override for titles/captions */
export function SkeletonLine({ className = '' }: SkeletonProps) {
  return <div className={`bg-white/[0.08] rounded-md h-4 ${className}`} />
}
