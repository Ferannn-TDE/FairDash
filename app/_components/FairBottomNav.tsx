'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline'
import {
  HomeIcon as HomeIconSolid,
  ClipboardDocumentListIcon as ClipboardIconSolid,
  ShoppingBagIcon as ShoppingBagIconSolid,
} from '@heroicons/react/24/solid'
import { UtensilsCrossed } from 'lucide-react'
import { useFair } from '../_contexts/FairContext'
import { useFairCart } from '../_contexts/FairCartContext'

export default function FairBottomNav() {
  const { fair } = useFair()
  const { itemCount } = useFairCart()
  const pathname = usePathname()
  const base = `/fair/${fair.slug}`
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const tabs = [
    { label: 'Home',    href: base,              Icon: HomeIcon,                     IconActive: HomeIconSolid },
    { label: 'Menu',    href: `${base}/menu`,    Icon: UtensilsCrossed,               IconActive: UtensilsCrossed },
    { label: 'Orders',  href: `${base}/orders`,  Icon: ClipboardDocumentListIcon,     IconActive: ClipboardIconSolid },
    { label: 'Cart',    href: `${base}/cart`,    Icon: ShoppingBagIcon,               IconActive: ShoppingBagIconSolid },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-bg-dark/95 backdrop-blur-md border-t border-white/10">
      <div className="flex items-center justify-around h-14">
        {tabs.map(({ label, href, Icon, IconActive }) => {
          const active = pathname === href
          const isCart = label === 'Cart'
          const ActiveIcon = IconActive

          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center gap-0.5 py-2 px-5 transition-colors ${
                active ? 'text-white' : 'text-text-gray'
              }`}
            >
              {active
                ? <ActiveIcon className="w-5 h-5" style={active ? { color: accentColor } : undefined} />
                : <Icon className="w-5 h-5" />
              }
              <span
                className="text-[10px] font-medium leading-none"
                style={active ? { color: accentColor } : undefined}
              >
                {label}
              </span>
              {isCart && itemCount > 0 && (
                <span
                  className="absolute top-1 right-2.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
