// Sign-in page copy for every role (BATCH-1 §21, sign-in redesign Q1–Q10, approved 2026-11-17).
// Word for word; locked by scripts/signin-copy-test.ts. Change only with Feran's OK.
//
// Vendor and organizer reuse their already-approved pitch copy (VENDOR_PITCH, ORGANIZERS_PAGE)
// verbatim. Strings written here for the first time were each approved by Feran on 2026-11-17.
import { VENDOR_PITCH } from '@/lib/vendor-pitch'
import { ORGANIZERS_PAGE } from '@/lib/organizer-copy'

export type SigninRole = 'vendor' | 'organizer' | 'runner' | 'customer' | 'admin'

export interface SigninPoint { title: string; text?: string }

export interface SigninCopy {
  eyebrow?: string        // small label above the headline
  heading: string         // the page's only H1
  line?: string           // under the H1, always shown
  videoSubline?: string   // under the H1, shown ONLY when the role's video is saved
  signUpTab?: string      // second tab; absent = sign-in only (no tabs)
  cardHeading?: string    // the card's H2
  points?: readonly SigninPoint[] // cards below the stage
}

// Organizer "What you can do": exactly two points have two parts (Q7b). The first sentence is the
// card title, the rest goes underneath; the other four are single titles. No words change.
const TWO_PART = new Set([0, 1])
function organizerPoints(): SigninPoint[] {
  return ORGANIZERS_PAGE.canDo.points.map((p, i) => {
    if (!TWO_PART.has(i)) return { title: p }
    const cut = p.indexOf('. ') + 1
    return { title: p.slice(0, cut), text: p.slice(cut + 1) }
  })
}

export const SIGNIN_COPY: Record<SigninRole, SigninCopy> = {
  vendor: {
    eyebrow: 'FOR VENDORS',
    heading: VENDOR_PITCH.heading,
    videoSubline: 'Watch how a booth runs on FairSynq, then sign in or apply.',
    signUpTab: 'Apply to sell',
    cardHeading: 'Run your booth',
    points: VENDOR_PITCH.points.map(p => ({ title: p.lead, text: p.text })),
  },
  organizer: {
    eyebrow: ORGANIZERS_PAGE.eyebrow,
    heading: ORGANIZERS_PAGE.heading,
    videoSubline: 'Watch how a fair runs on FairSynq, then sign in or apply.',
    signUpTab: 'Apply to host',
    cardHeading: 'Host your event',
    points: organizerPoints(),
  },
  runner: {
    heading: 'Runner sign-in',
    line: 'Sign in to see and claim curbside orders at your event.',
  },
  customer: {
    heading: 'Almost there',
    line: 'Sign in to place your order and track it live across the fairgrounds.',
    signUpTab: 'Create account',
  },
  admin: {
    eyebrow: 'Admin · internal',
    heading: 'Admin sign-in',
    line: 'Restricted access. Sign in with your FairSynq admin account.',
  },
}

export const SIGN_IN_TAB = 'Sign in'
