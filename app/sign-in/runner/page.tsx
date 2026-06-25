"use client";
import { Truck } from "lucide-react";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

export default function RunnerSignInPage() {
  return (
    <RoleAuthCard
      role="runner"
      Icon={Truck}
      eyebrow="Runner sign-in"
      heading="Deliver & earn"
      blurb="Claim deliveries, run orders across the fairgrounds, and get paid per drop."
      redirectTo="/runner"
    />
  );
}
