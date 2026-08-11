import { EnvelopeIcon, ClockIcon } from '@heroicons/react/24/outline'
import { FacebookIcon } from '@/components/icons/FacebookIcon'
import {
  CONTACT_EMAIL,
  FACEBOOK_URL,
  RESPONSE_TIME,
  SUPPORT_SUBJECT,
  contactMailto,
} from '@/lib/contact-info'

/**
 * THE CONTACT CARDS — one definition, rendered by BOTH /contact and the landing
 * section, so the two surfaces cannot describe the same channels differently.
 * (Same shape as faq-content.ts: one array, two renderers.)
 *
 * ── WHY THESE THREE AND NOT EMAIL / PHONE / ADDRESS ──────────────────────────
 * The reference design this is styled after ships Email / Live-Support-phone /
 * Studio-Location-address, with placeholder values. Two of those three CANNOT be
 * filled truthfully here:
 *
 *   • There is no support phone line. The only `tel:` in the codebase is the
 *     RUNNER's number on an active delivery (DeliveryTracking.tsx) — per-order and
 *     real. A "Live Support" card would need a number that rings nowhere.
 *   • There is no office. Every address in the tree is a customer delivery
 *     address or an event location. A "Studio Location" card would be fiction.
 *
 * So the card set is the three channels that ARE real: the inbox, the Facebook
 * page (already named as a support channel in the refund policy), and the
 * response-time commitment. The reference layout survives intact —
 * icon / title / description / detail, three across — and every value is true.
 *
 * Adding a phone or address card later means acquiring a phone or an address
 * first, not writing one here.
 */

export interface ContactChannel {
  icon: React.ElementType
  title: string
  description: string
  /** The concrete value — the line a user acts on. */
  detail: string
  /** Where the card goes. `null` = nothing to click (the response-time promise). */
  href: string | null
  external?: boolean
}

export const CONTACT_CHANNELS: ContactChannel[] = [
  {
    icon: EnvelopeIcon,
    title: 'Email Us',
    description: `Send us your questions and we'll respond ${RESPONSE_TIME}.`,
    detail: CONTACT_EMAIL,
    href: contactMailto(SUPPORT_SUBJECT),
  },
  {
    icon: FacebookIcon,
    title: 'Facebook',
    description: 'Reach us on Facebook for updates and support.',
    detail: 'Message us on Facebook',
    href: FACEBOOK_URL,
    external: true,
  },
  {
    icon: ClockIcon,
    title: 'Response Time',
    description: 'We reply to every message.',
    // Capitalised for the card's detail slot; the promise itself is the shared constant.
    detail: RESPONSE_TIME.charAt(0).toUpperCase() + RESPONSE_TIME.slice(1),
    href: null,
  },
]

/**
 * One card. Renders as an <a> when there is somewhere to go and a <div> when
 * there isn't — so the response-time card doesn't advertise a click that does
 * nothing (the affordance has to match the behaviour, same rule as the rest).
 */
export function ContactChannelCard({ channel }: { channel: ContactChannel }) {
  const { icon: Icon, title, description, detail, href, external } = channel

  const body = (
    <>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 shrink-0 bg-neon-pink/10 border border-neon-pink/20">
        <Icon className="w-5 h-5 text-neon-pink" />
      </div>
      <h3 className="font-bebas text-xl tracking-wide text-white mb-1.5">{title}</h3>
      <p className="text-text-gray text-sm leading-relaxed mb-3 flex-1">{description}</p>
      <p className="text-sm font-medium text-neon-pink break-words">{detail}</p>
    </>
  )

  const shell =
    'flex flex-col h-full p-6 bg-white/[0.03] border border-white/[0.08] rounded-2xl transition-all duration-300 no-underline'

  if (!href) {
    return <div className={shell}>{body}</div>
  }

  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`group ${shell} hover:border-neon-pink/30 hover:bg-white/[0.05] hover:shadow-[0_8px_32px_rgba(255,0,119,0.12)] motion-safe:hover:-translate-y-0.5`}
    >
      {body}
    </a>
  )
}
