"use client";
import { CalendarDays } from "lucide-react";
import RoleAuthCard from "@/app/_components/RoleAuthCard";
import { ORGANIZER_LOGIN_BLURB } from "@/lib/organizer-copy";

export default function OrganizerLoginPage() {
  return (
    <RoleAuthCard
      role="organizer"
      Icon={CalendarDays}
      eyebrow="Organizer sign-in"
      heading="Host your event"
      blurb={ORGANIZER_LOGIN_BLURB}
      redirectTo="/organizer"
    />
  );
}
