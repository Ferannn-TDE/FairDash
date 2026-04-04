'use client'

import { motion, type Variants } from 'framer-motion'
import { useReducedMotion } from 'framer-motion'

// ── Shared timing configs ─────────────────────────────────────────────────────

export const TIMING = {
  fast:        0.3,
  normal:      0.5,
  slow:        0.8,
  stagger:     0.1,
  staggerSlow: 0.15,
} as const

export const EASE = {
  smooth:     [0.25, 0.1, 0.25, 1.0] as const,
  bounce:     [0.34, 1.56, 0.64, 1]  as const,
  decelerate: [0.0,  0.0,  0.2,  1]  as const,
  sharp:      [0.4,  0.0,  0.6,  1]  as const,
} as const

// ── Reusable variant sets ─────────────────────────────────────────────────────

export const fadeUp: Variants = {
  hidden:  { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: TIMING.normal, ease: EASE.decelerate },
  },
}

export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: TIMING.slow, ease: EASE.smooth },
  },
}

export const scaleIn: Variants = {
  hidden:  { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: TIMING.normal, ease: EASE.decelerate },
  },
}

export const slideInLeft: Variants = {
  hidden:  { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: TIMING.normal, ease: EASE.decelerate },
  },
}

export const slideInRight: Variants = {
  hidden:  { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: TIMING.normal, ease: EASE.decelerate },
  },
}

export const staggerContainer: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: TIMING.stagger,
      delayChildren: 0.1,
    },
  },
}

export const staggerContainerSlow: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: TIMING.staggerSlow,
      delayChildren: 0.2,
    },
  },
}

// ── Scroll-triggered reveal ───────────────────────────────────────────────────

interface RevealProps {
  children: React.ReactNode
  variants?: Variants
  className?: string
  delay?: number
  once?: boolean
}

export function Reveal({
  children,
  variants = fadeUp,
  className = '',
  delay = 0,
  once = true,
}: RevealProps) {
  const prefersReduced = useReducedMotion()

  if (prefersReduced) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-80px' }}
      variants={variants}
      className={className}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  )
}

// ── Stagger wrapper ───────────────────────────────────────────────────────────

interface StaggerProps {
  children: React.ReactNode
  className?: string
  slow?: boolean
}

export function Stagger({ children, className = '', slow = false }: StaggerProps) {
  const prefersReduced = useReducedMotion()

  if (prefersReduced) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px' }}
      variants={slow ? staggerContainerSlow : staggerContainer}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Stagger child ─────────────────────────────────────────────────────────────

interface StaggerItemProps {
  children: React.ReactNode
  className?: string
}

export function StaggerItem({ children, className = '' }: StaggerItemProps) {
  return (
    <motion.div variants={fadeUp} className={className}>
      {children}
    </motion.div>
  )
}

export { motion }
