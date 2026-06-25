"use client";
import { Store } from "lucide-react";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

export default function VendorSignInPage() {
  return (
    <RoleAuthCard
      role="vendor"
      Icon={Store}
      eyebrow="Vendor sign-in"
      heading="Run your booth"
      blurb="Manage your menu, take orders, and track your take-home earnings — all from your phone."
      redirectTo="/vendor"
    />
  );
}
