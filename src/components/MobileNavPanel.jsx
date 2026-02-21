import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useUser, useClerk } from "@clerk/clerk-react";
import {
  Squares2X2Icon,
  BuildingStorefrontIcon,
  HeartIcon,
  TruckIcon,
  ClockIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import SidePanel from "./SidePanel";
import SignOutModal from "./SignOutModal";
import { useMobileMenu } from "../context/MobileMenuContext";

const navLinks = [
  { label: "Menu", icon: Squares2X2Icon, to: "/menu" },
  { label: "Vendors", icon: BuildingStorefrontIcon, to: "/vendors" },
  { label: "Favorites", icon: HeartIcon, to: "/favorites" },
  { label: "Track Order", icon: TruckIcon, to: "/track" },
  { label: "History", icon: ClockIcon, to: "/history" },
];

const MobileNavPanel = () => {
  const { isMobileMenuOpen, setIsMobileMenuOpen } = useMobileMenu();
  const location = useLocation();
  const navigate = useNavigate();
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  const close = () => setIsMobileMenuOpen(false);

  const handleSignOut = () => {
    close();
    signOut(() => {
      toast.success("Signed out successfully. See you soon! 👋");
      navigate("/");
    });
  };

  return (
    <>
      <SidePanel isOpen={isMobileMenuOpen} onClose={close} type="menu">
        <div className="p-4">
          {/* User info */}
          {isSignedIn && (
            <div className="flex items-center gap-3 p-4 mb-3 bg-bg-card rounded-xl border border-white/5">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-pink to-[#e0006b] flex items-center justify-center shadow-[0_4px_12px_rgba(255,0,119,0.3)] flex-shrink-0">
                <span className="text-white font-bold text-base">
                  {(
                    user?.firstName?.[0] ||
                    user?.emailAddresses?.[0]?.emailAddress?.[0] ||
                    "U"
                  ).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold text-sm truncate">
                  {user?.firstName
                    ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
                    : "User"}
                </div>
                <div className="text-text-gray text-xs truncate">
                  {user?.emailAddresses?.[0]?.emailAddress || ""}
                </div>
              </div>
            </div>
          )}

          {/* Nav links */}
          {navLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                onClick={close}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-[0.9375rem] mb-1 no-underline transition-all duration-200 ${
                  location.pathname === item.to
                    ? "bg-neon-pink/10 text-neon-pink"
                    : "text-text-gray hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}

          {/* Free Delivery Promo */}
          <div className="mt-4 mb-2 p-5 bg-neon-pink/10 rounded-2xl border border-neon-pink/20">
            <div className="font-bold text-neon-pink mb-1">Free Delivery</div>
            <div className="text-xs text-text-gray">On orders over $25</div>
          </div>

          {/* Sign Out */}
          {isSignedIn && (
            <button
              onClick={() => setShowSignOutModal(true)}
              className="flex items-center gap-3 px-4 py-3.5 w-full text-left text-text-gray hover:text-red-400 hover:bg-white/5 rounded-xl transition-all duration-200 font-semibold text-[0.9375rem] bg-transparent border-t border-white/10 cursor-pointer mt-2 pt-4"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5" />
              Sign Out
            </button>
          )}
        </div>
      </SidePanel>

      <SignOutModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleSignOut}
      />
    </>
  );
};

export default MobileNavPanel;
