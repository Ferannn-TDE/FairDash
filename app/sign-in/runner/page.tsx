"use client";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

// Runner sign-in: sign-in only (BATCH-1 §21 Q5; individual runner sign-up is retired, C-12).
export default function RunnerSignInPage() {
  return <RoleAuthCard role="runner" redirectTo="/runner" />;
}
