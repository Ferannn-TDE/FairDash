import Link from 'next/link'
import { Reveal, Stagger, StaggerItem } from '@/components/animations/motion'
import { CONTACT_CHANNELS, ContactChannelCard } from './contact-channels'

/**
 * Landing contact block — the same three channels the /contact page renders,
 * from the same array, so the two surfaces cannot disagree about how to reach us.
 *
 * Cards + a link TO /contact, deliberately NOT a second form. One contact
 * destination means one place to keep honest; a second submit path is a second
 * thing that can start lying (the fake form this arc removed was the first).
 *
 * Heading idiom is RoleSection's (eyebrow / bebas h2 with one pink phrase /
 * gray subtitle, wrapped in Reveal) so it reads as part of the page rather than
 * a bolted-on block.
 */
export default function ContactSection() {
  return (
    <section className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-20">
      <Reveal className="text-center mb-10">
        <p className="text-[11px] text-neon-pink font-inter font-semibold uppercase tracking-[0.2em] mb-3">
          Still have questions?
        </p>
        <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
          Talk to a <span className="text-neon-pink">real person</span>
        </h2>
        <p className="mt-3 text-text-gray text-sm sm:text-base max-w-xl mx-auto">
          Order trouble, vendor questions, or anything else — here&apos;s how to reach us.
        </p>
      </Reveal>

      <Stagger className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 max-w-5xl mx-auto">
        {CONTACT_CHANNELS.map(channel => (
          <StaggerItem key={channel.title}>
            <ContactChannelCard channel={channel} />
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal className="text-center mt-8">
        <Link
          href="/contact"
          className="text-sm text-text-gray hover:text-white transition-colors underline underline-offset-4"
        >
          Visit our contact page →
        </Link>
      </Reveal>
    </section>
  )
}
