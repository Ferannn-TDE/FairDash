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
import SidePanel from "./SidePanel";
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
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();

  const close = () => setIsMobileMenuOpen(false);

  return (
    <SidePanel isOpen={isMobileMenuOpen} onClose={close} type="menu">
      <div className="flex flex-col flex-1 p-4 overflow-y-auto">
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

        <div className="flex-1" />

        {/* Free Delivery Promo */}
        <div className="my-4 p-5 bg-neon-pink/10 rounded-2xl border border-neon-pink/20">
          <div className="font-bold text-neon-pink mb-1">Free Delivery</div>
          <div className="text-xs text-text-gray">On orders over $25</div>
        </div>

        {/* Sign Out */}
        {isSignedIn && (
          <button
            onClick={() => {
              close();
              signOut(() => navigate("/"));
            }}
            className="flex items-center gap-3 px-4 py-3.5 w-full text-left text-text-gray hover:text-neon-pink hover:bg-white/5 rounded-xl transition-all duration-200 font-semibold text-[0.9375rem] bg-transparent border-t border-white/10 cursor-pointer mt-2 pt-4"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            Sign Out
          </button>
        )}
      </div>
    </SidePanel>
  );
};

export default MobileNavPanel;
