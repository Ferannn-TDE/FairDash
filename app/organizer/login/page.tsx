"use client";
import { CalendarDays } from "lucide-react";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

export default function OrganizerLoginPage() {
  return (
    <RoleAuthCard
      role="organizer"
      Icon={CalendarDays}
      eyebrow="Organizer sign-in"
      heading="Host your event"
      blurb="Create fairs, approve vendors, monitor orders live, and run your event end to end."
      redirectTo="/organizer"
    />
  );
}
