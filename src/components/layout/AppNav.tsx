import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightOnRectangleIcon,
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  HomeIcon,
  ShoppingBagIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { Link } from "@tanstack/react-router";
import { AppNavLink } from "@/components/layout/AppNavLink";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";

/**
 * Sticky app header.
 *
 * Layout direct-ported from `components/AppNav.vue`:
 *   • Top row: logo / desktop inline nav / theme toggle / logout button
 *   • Second row (mobile only, `sm:hidden`): horizontal-scroll nav with
 *     `icon stacked above label` items, hidden scrollbar.
 *
 * The logout button is inlined (not pulled from `@/components/ui/button`)
 * so Phase 1A has no dependency on Phase 1B's shadcn Button work. Classes
 * mirror the original Button.vue ghost+sm variant exactly.
 */

const NAV_ITEMS = [
  { to: "/", label: "Početna", icon: HomeIcon },
  { to: "/events", label: "Događaji", icon: CalendarIcon },
  { to: "/payments", label: "Plaćanja", icon: BanknotesIcon },
  { to: "/birthdays", label: "Rođendani", icon: CakeIcon },
  { to: "/expenses", label: "Planirani troškovi", icon: ShoppingBagIcon },
] as const;

export function AppNav() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    await navigate({ to: "/login" });
  };

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-gray-200/80 bg-white/80 backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-800/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2" aria-label="Početna">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 dark:bg-blue-500">
              <UserGroupIcon className="h-5 w-5 text-white" />
            </div>
          </Link>
          <div className="hidden gap-1 sm:flex">
            {NAV_ITEMS.map((item) => (
              <AppNavLink key={item.to} to={item.to} label={item.label} icon={item.icon} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Odjavi se"
            onClick={() => {
              void handleLogout();
            }}
            className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-all duration-150 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-[0.98] dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-900"
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            <span className="ml-2 hidden sm:inline">Odjavi se</span>
          </button>
        </div>
      </div>
      {/* Mobile bottom nav with horizontal scroll — icons stacked above labels */}
      <div className="scrollbar-hide flex w-full gap-1 overflow-x-auto border-t border-gray-200/80 px-4 py-2 dark:border-gray-700/80 sm:hidden">
        {NAV_ITEMS.map((item) => (
          <AppNavLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            className="shrink-0"
          />
        ))}
      </div>
    </nav>
  );
}
