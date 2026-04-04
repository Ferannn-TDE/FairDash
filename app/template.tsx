'use client'

import { motion } from 'framer-motion'
import { EASE } from '@/components/animations/motion'

// Subtle fade-in on every page navigation — 0.3s, no layout shift.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE.smooth }}
    >
      {children}
    </motion.div>
  )
}
