"use client";
import { ShieldCheck } from "lucide-react";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

// Internal, invite-only. No sign-up, no marketing — just a quiet gate.
export default function AdminLoginPage() {
  return (
    <RoleAuthCard
      role="admin"
      Icon={ShieldCheck}
      eyebrow="Admin · internal"
      heading="Admin sign-in"
      blurb="Restricted access. Sign in with your FairSynq admin account."
      redirectTo="/admin"
      allowSignUp={false}
      quiet
    />
  );
}
