import { useReducedMotion } from 'framer-motion'

/**
 * Returns true when animations should play.
 * Returns false when the user has enabled "Reduce motion" in their OS settings.
 */
export function useMotionSafe(): boolean {
  const prefersReduced = useReducedMotion()
  return !prefersReduced
}
