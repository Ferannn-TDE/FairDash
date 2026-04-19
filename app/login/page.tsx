import { Suspense } from 'react'
import LoginContent from './LoginContent'

export const metadata = {
  title: 'Sign In — FairSynq',
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
      <LoginContent />
    </Suspense>
  )
}
