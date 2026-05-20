import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightOnRectangleIcon,
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  HomeIcon,
  MoonIcon,
  SunIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import { AppNavLink } from "@/components/layout/AppNavLink";
import { UserAvatar } from "@/components/layout/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { getDisplayName } from "@/utils/identity";

/**
 * App chrome.
 *
 * Desktop (>= sm): top sticky header with logo + inline nav + the shared
 * hamburger dropdown (theme / settings / logout). No bottom bar.
 *
 * Mobile (< sm): top header is logo + the same hamburger dropdown.
 * Navigation lives in a fixed bottom tab bar (Home / Events / Payments /
 * Birthdays) — the 4 most-used destinations. The dropdown additionally
 * surfaces the 5th nav item (Rođendani) since it isn't in the bar.
 *
 * The dropdown is the single source of truth for theme/settings/logout on
 * every viewport so the chrome stays consistent. The "Stranice" section
 * inside the dropdown is mobile-only — desktop already has the same links
 * inline, so showing them twice would just be visual noise.
 *
 * The bottom bar uses `padding: env(safe-area-inset-bottom)` so it doesn't
 * collide with the iPhone home indicator when running as an installed PWA.
 */

// Bottom bar is mobile-only and limited to 4 slots. Lists usage now
// outpaces birthday checks day-to-day (shopping is a near-daily activity
// vs. a few birthdays a year), so Liste replaces Rođendani here. The
// desktop top bar still surfaces both — it has the horizontal room.
const BOTTOM_NAV_ITEMS = [
  { to: "/", label: "Početna", icon: HomeIcon },
  { to: "/events", label: "Događaji", icon: CalendarIcon },
  { to: "/payments", label: "Plaćanja", icon: BanknotesIcon },
  { to: "/lists", label: "Liste", icon: ClipboardDocumentListIcon },
] as const;

// Desktop adds Rođendani; the mobile dropdown ("Stranice") also pulls
// from this array so birthdays remain one tap away on phones.
const DESKTOP_NAV_ITEMS = [
  ...BOTTOM_NAV_ITEMS,
  { to: "/birthdays", label: "Rođendani", icon: CakeIcon },
] as const;

export function AppNav() {
  return (
    <>
      <nav className="sticky top-0 z-40 w-full border-b border-gray-200/80 bg-white/80 backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-800/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2" aria-label="Početna">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 dark:bg-blue-500">
                <UserGroupIcon className="h-5 w-5 text-white" />
              </div>
            </Link>
            <div className="hidden gap-1 md:flex">
              {DESKTOP_NAV_ITEMS.map((item) => (
                <AppNavLink key={item.to} to={item.to} label={item.label} icon={item.icon} />
              ))}
            </div>
          </div>
          <AppMenu />
        </div>
      </nav>
      <MobileBottomNav />
    </>
  );
}

function AppMenu() {
  const { signOut, user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();

  const handleLogout = async () => {
    await signOut();
    await navigate({ to: "/login" });
  };

  const identity = {
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    email: user?.email ?? null,
  };
  const displayName = getDisplayName(identity);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Korisnički meni"
          // Avatar doubles as the dropdown trigger — visually distinct from
          // a hamburger so the affordance reads as "your account / menu".
          // The chevron is the explicit "this opens a dropdown" hint and
          // sits next to the name on wider viewports where there's room.
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pl-0.5 pr-1.5 text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-[0.98] dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-900"
        >
          <UserAvatar {...identity} className="h-8 w-8" />
          <span className="hidden max-w-[12rem] truncate text-sm font-medium lg:inline">
            {displayName}
          </span>
          <ChevronDownIcon className="hidden h-4 w-4 text-gray-500 dark:text-gray-400 lg:inline" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <UserAvatar {...identity} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {displayName}
            </div>
            {user?.email && displayName !== user.email ? (
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                {user.email}
              </div>
            ) : null}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-gray-500 dark:text-gray-400">
          Tema
        </DropdownMenuLabel>
        <div className="px-2 py-1.5">
          <ThemePickerRow mode={mode} onSelect={setMode} />
        </div>
        {/* Nav-link section is mobile-only — desktop already has these
            5 links inline in the top bar. The mobile/desktop boundary
            is `md` (768px), matching the bottom-nav flip below. */}
        <div className="md:hidden">
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-gray-500 dark:text-gray-400">
            Stranice
          </DropdownMenuLabel>
          {DESKTOP_NAV_ITEMS.map((item) => (
            <DropdownMenuItem key={item.to} asChild>
              <Link to={item.to} className="flex w-full cursor-pointer items-center gap-2">
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="flex w-full cursor-pointer items-center gap-2">
            <Cog6ToothIcon className="h-4 w-4" />
            <span>Podešavanja</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleLogout();
          }}
          className="cursor-pointer"
        >
          <ArrowRightOnRectangleIcon className="h-4 w-4" />
          <span>Odjavi se</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ThemePickerRowProps {
  mode: ThemeMode;
  onSelect: (next: ThemeMode) => void;
}

function ThemePickerRow({ mode, onSelect }: ThemePickerRowProps) {
  // Mirrors the desktop ThemeToggle three-button pill but rendered inside
  // the dropdown. Clicking a button doesn't dismiss the menu (the pill is
  // not a DropdownMenuItem), matching how iOS share-sheet style menus keep
  // toggles available without closing.
  return (
    <div className="flex w-full items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
      <ThemeButton
        active={mode === "light"}
        onClick={() => onSelect("light")}
        ariaLabel="Svetla tema"
        activeColor="text-amber-500"
        icon={SunIcon}
      />
      <ThemeButton
        active={mode === "dark"}
        onClick={() => onSelect("dark")}
        ariaLabel="Tamna tema"
        activeColor="text-blue-500"
        icon={MoonIcon}
      />
      <ThemeButton
        active={mode === "auto"}
        onClick={() => onSelect("auto")}
        ariaLabel="Automatska tema"
        activeColor="text-gray-700 dark:text-gray-200"
        icon={ComputerDesktopIcon}
      />
    </div>
  );
}

interface ThemeButtonProps {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  activeColor: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

function ThemeButton({ active, onClick, ariaLabel, activeColor, icon: Icon }: ThemeButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center rounded-md p-1.5 transition-colors",
        active
          ? cn("bg-white shadow-sm dark:bg-gray-800", activeColor)
          : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function MobileBottomNav() {
  return (
    <nav
      // `pb-[env(safe-area-inset-bottom)]` keeps the row above the iPhone
      // home indicator when launched from the home screen as a PWA.
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] dark:border-gray-700/80 dark:bg-gray-800/95 md:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5 pb-1.5">
        {BOTTOM_NAV_ITEMS.map((item) => (
          <AppNavLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            className="flex-1 text-xs"
          />
        ))}
      </div>
    </nav>
  );
}
