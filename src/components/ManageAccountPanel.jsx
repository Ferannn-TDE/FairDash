import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  UserCircleIcon,
  MapPinIcon,
  CreditCardIcon,
  BellIcon,
  ShieldCheckIcon,
  ClockIcon,
  HeartIcon,
  ChevronRightIcon,
  BuildingStorefrontIcon,
  ShoppingBagIcon,
  BanknotesIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useMobileMenu } from "../context/MobileMenuContext";

const ManageAccountPanel = () => {
  const { user } = useUser();
  const { setIsAccountPanelOpen } = useMobileMenu();

  const close = () => setIsAccountPanelOpen(false);

  const isVendor = !!user?.unsafeMetadata?.isVendor;

  const menuItems = [
    {
      icon: UserCircleIcon,
      label: "Edit Profile",
      description: "Update your personal information",
      to: "/account",
    },
    ...(isVendor ? [{
      icon: BuildingStorefrontIcon,
      label: "Vendor Dashboard",
      description: "Manage your booth & orders",
      to: "/vendor/dashboard",
    }] : []),
    {
      icon: MapPinIcon,
      label: "Saved Addresses",
      description: "Manage delivery locations",
      to: "/account",
    },
    {
      icon: CreditCardIcon,
      label: "Payment Methods",
      description: "Manage cards and payment options",
      to: "/account",
    },
    {
      icon: ClockIcon,
      label: "Order History",
      description: "View your past orders",
      to: "/history",
    },
    {
      icon: HeartIcon,
      label: "Favorites",
      description: "Your saved items",
      to: "/favorites",
    },
    {
      icon: BellIcon,
      label: "Notifications",
      description: "Customize your alerts",
      to: "/account",
    },
    {
      icon: ShieldCheckIcon,
      label: "Privacy & Security",
      description: "Manage your account security",
      to: "/account",
    },
  ];

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
    : user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "User";

  const initial = (user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0] || "U").toUpperCase();

  const stats = [
    { icon: ShoppingBagIcon, value: "12", label: "Orders" },
    { icon: BanknotesIcon, value: "$0", label: "Saved" },
    { icon: SparklesIcon, value: "Gold", label: "Member" },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">

      {/* Profile section */}
      <div className="px-5 pt-5 pb-4">

        {/* Avatar + name */}
        <div className="flex items-center gap-3.5 mb-4">
          <div className="relative flex-shrink-0">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-neon-pink via-[#ff3399] to-[#cc0060] flex items-center justify-center shadow-[0_4px_20px_rgba(255,0,119,0.35)]">
              <span className="text-white font-bold text-xl">{initial}</span>
            </div>
            <div className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0a0a0a]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-[0.9375rem] truncate">{displayName}</p>
            <p className="text-text-gray text-xs truncate mb-1.5">
              {user?.emailAddresses?.[0]?.emailAddress || ""}
            </p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-neon-pink/[0.12] border border-neon-pink/20 rounded-full text-neon-pink text-[0.5625rem] font-semibold uppercase tracking-wide">
              <SparklesIcon className="w-2.5 h-2.5" />
              Member
            </span>
          </div>
        </div>

        {/* Pink accent divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-neon-pink/40 to-transparent mb-4" />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="bg-white/[0.04] rounded-xl p-3 flex flex-col items-center gap-1.5 border border-white/[0.06]"
              >
                <Icon className="w-4 h-4 text-neon-pink" />
                <p className="text-white font-bold text-sm leading-none">{stat.value}</p>
                <p className="text-text-gray text-[0.5625rem] uppercase tracking-wide">{stat.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section divider */}
      <div className="mx-5 h-px bg-white/[0.07]" />

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={close}
              className="flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-white/[0.04] transition-all duration-200 no-underline group"
            >
              <div className="w-8 h-8 bg-white/[0.05] rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-neon-pink/10 transition-colors duration-200">
                <Icon className="w-4 h-4 text-text-gray group-hover:text-neon-pink transition-colors duration-200" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium leading-tight group-hover:text-neon-pink transition-colors duration-200">{item.label}</p>
                <p className="text-text-gray/60 text-[0.6875rem] truncate mt-0.5">{item.description}</p>
              </div>
              <ChevronRightIcon className="w-3.5 h-3.5 text-white/20 flex-shrink-0 group-hover:text-neon-pink/50 transition-colors duration-200" />
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default ManageAccountPanel;
