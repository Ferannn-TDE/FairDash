"use client";
import { Store } from "lucide-react";
import { CheckIcon } from "@heroicons/react/24/outline";
import RoleAuthCard from "@/app/_components/RoleAuthCard";
import { VENDOR_PITCH } from "@/lib/vendor-pitch";

// The vendor pitch (item 8, B1.9) sits above the sign-in card; copy in lib/vendor-pitch.ts.
function VendorPitch() {
  return (
    <section aria-label="Why sell with FairSynq">
      <h1 className="font-bebas text-3xl sm:text-4xl text-white tracking-wide leading-none">{VENDOR_PITCH.heading}</h1>
      <ul className="mt-4 space-y-3">
        {VENDOR_PITCH.points.map(({ lead, text }) => (
          <li key={lead} className="flex items-start gap-2.5 text-sm text-text-gray leading-relaxed">
            <CheckIcon className="w-4 h-4 text-neon-pink shrink-0 mt-0.5" />
            <span><strong className="text-white font-semibold">{lead}</strong> {text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function VendorSignInPage() {
  return (
    <RoleAuthCard
      role="vendor"
      Icon={Store}
      eyebrow="Vendor sign-in"
      heading="Run your booth"
      blurb="Manage your menu, take orders, and track your take-home earnings — all from your phone."
      redirectTo="/vendor"
      pitch={<VendorPitch />}
    />
  );
}
