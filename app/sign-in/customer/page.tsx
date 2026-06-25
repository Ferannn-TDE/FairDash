"use client";
import { ShoppingBag } from "lucide-react";
import RoleAuthCard from "@/app/_components/RoleAuthCard";

// The customer auth moment. By design customers browse free and only sign in at
// checkout, so this page exists to be reached WITH a ?redirect= back to wherever
// they were (checkout, order tracking, order history). RoleAuthCard honors it.
export default function CustomerSignInPage() {
  return (
    <RoleAuthCard
      role="customer"
      Icon={ShoppingBag}
      eyebrow="Sign in"
      heading="Almost there"
      blurb="Sign in to place your order and track it live across the fairgrounds."
      redirectTo="/fairs"
    />
  );
}
