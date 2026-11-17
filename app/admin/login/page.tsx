"use client";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

// Internal, invite-only. No sign-up, no pitch, no video — a quiet gate (BATCH-1 §21 Q10).
export default function AdminLoginPage() {
  return <RoleAuthCard role="admin" redirectTo="/admin" quiet />;
}
