import { useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightOnRectangleIcon,
  BanknotesIcon,
  CakeIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  EllipsisHorizontalIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  Squares2X2Icon,
  SunIcon,
  UserGroupIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import { AppNavLink } from "@/components/layout/AppNavLink";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useIsKeyboardOpen } from "@/hooks/useIsKeyboardOpen";
import { useProfile } from "@/hooks/useProfile";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { getDisplayName } from "@/utils/identity";

/**
 * App chrome.
 *
 * Desktop (>= lg): top sticky header with logo + the full inline nav + the
 * account dropdown (theme / settings / logout). No bottom bar.
 *
 * Mobile + tablet (< lg): top header is logo + the account dropdown. Navigation
 * lives in a fixed bottom tab bar — Danas · Uskoro · Liste · Više, where "Više"
 * is a dropup to the management pages (Aktivnosti / Događaji / Plaćanja /
 * Rođendani) + Podešavanja, staying highlighted while you're on any of them.
 *
 * The breakpoint is `lg` (1024px), not `md`: the desktop row carries 7 items now
 * (Danas + Uskoro replaced the single dashboard link), which is tight at 768px —
 * so tablets keep the bottom bar.
 *
 * The bottom bar uses `padding: env(safe-area-inset-bottom)` so it doesn't
 * collide with the iPhone home indicator when running as an installed PWA.
 */

type NavItem = { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

// Full desktop row (>= lg). Danas + Uskoro are the two agenda scopes.
const DESKTOP_NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Danas", icon: HomeIcon },
  { to: "/uskoro", label: "Uskoro", icon: CalendarDaysIcon },
  { to: "/activities", label: "Aktivnosti", icon: Squares2X2Icon },
  { to: "/events", label: "Događaji", icon: CalendarIcon },
  { to: "/payments", label: "Plaćanja", icon: BanknotesIcon },
  { to: "/budget", label: "Budžet", icon: WalletIcon },
  { to: "/lists", label: "Liste", icon: ClipboardDocumentListIcon },
  { to: "/birthdays", label: "Rođendani", icon: CakeIcon },
];

// Bottom bar primaries (< lg) — the three highest-frequency destinations; the
// rest live under "Više".
const BOTTOM_PRIMARY_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Danas", icon: HomeIcon },
  { to: "/uskoro", label: "Uskoro", icon: CalendarDaysIcon },
  { to: "/lists", label: "Liste", icon: ClipboardDocumentListIcon },
];

// Pages reached through the "Više" dropup (Podešavanja appended after a divider).
const MORE_ITEMS: readonly NavItem[] = [
  { to: "/activities", label: "Aktivnosti", icon: Squares2X2Icon },
  { to: "/events", label: "Događaji", icon: CalendarIcon },
  { to: "/payments", label: "Plaćanja", icon: BanknotesIcon },
  { to: "/budget", label: "Budžet", icon: WalletIcon },
  { to: "/birthdays", label: "Rođendani", icon: CakeIcon },
];

export function AppNav() {
  // Global search: ⌘/Ctrl+K toggles, the magnifying-glass button opens.
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {/* Opaque, NOT translucent + backdrop-blur: iOS Safari fails to repaint a
          `backdrop-filter` on a sticky bar during fast scroll (the header flickers/
          blanks), and blanks it entirely when a Radix menu toggles body overflow.
          A solid background sidesteps both. */}
      <nav className="sticky top-0 z-40 w-full border-b border-gray-200/80 bg-white dark:border-gray-700/80 dark:bg-gray-800">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2" aria-label="Početna">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 dark:bg-blue-500">
                <UserGroupIcon className="h-5 w-5 text-white" />
              </div>
            </Link>
            <div className="hidden gap-1 lg:flex">
              {DESKTOP_NAV_ITEMS.map((item) => (
                <AppNavLink key={item.to} to={item.to} label={item.label} icon={item.icon} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Pretraga"
              title="Pretraga (⌘K)"
              onClick={() => setSearchOpen(true)}
              className="flex size-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <MagnifyingGlassIcon className="h-5 w-5" />
            </button>
            <AppMenu />
          </div>
        </div>
      </nav>
      <MobileBottomNav />
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
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
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pr-1.5 pl-0.5 text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-900"
        >
          <UserAvatar {...identity} className="h-8 w-8" />
          <span className="hidden max-w-[12rem] truncate text-sm font-medium lg:inline">
            {displayName}
          </span>
          <ChevronDownIcon className="hidden h-4 w-4 text-gray-500 lg:inline dark:text-gray-400" />
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
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
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
        {/* Page links aren't repeated here — the bottom bar (Danas/Uskoro/Liste
            + the "Više" dropup) covers navigation below lg, and the top row
            covers it at lg+. */}
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
  icon: ComponentType<SVGProps<SVGSVGElement>>;
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
  // iOS Safari auto-elevates `position: fixed` elements above the on-screen
  // keyboard, so the nav ends up sandwiched between the form and the keyboard.
  // We outright unmount it while the keyboard is open (see useIsKeyboardOpen).
  const keyboardOpen = useIsKeyboardOpen();
  if (keyboardOpen) return null;

  return (
    <nav
      // `pb-[env(safe-area-inset-bottom)]` keeps the row above the iPhone
      // home indicator when launched from the home screen as a PWA. Opaque
      // background (no backdrop-blur) for the same iOS repaint reason as the
      // top header — a fixed `backdrop-filter` bar flickers during scroll.
      className="fixed right-0 bottom-0 left-0 z-30 border-t border-gray-200/80 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden dark:border-gray-700/80 dark:bg-gray-800"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5 pb-1.5">
        {BOTTOM_PRIMARY_ITEMS.map((item) => (
          <AppNavLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            className="flex-1 text-xs"
          />
        ))}
        <MoreNavMenu />
      </div>
    </nav>
  );
}

/**
 * "Više" — a dropup (Radix DropdownMenu, content `side="top"`) to the management
 * pages. The trigger looks like a bottom-nav item and stays highlighted while
 * the current route is one of those pages, mirroring Todoist's "Browse".
 */
function MoreNavMenu() {
  const matchRoute = useMatchRoute();
  const isMoreRoute =
    MORE_ITEMS.some((item) => !!matchRoute({ to: item.to, fuzzy: true })) ||
    !!matchRoute({ to: "/settings", fuzzy: true });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Više"
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
            isMoreRoute
              ? "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white"
              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white",
          )}
        >
          <EllipsisHorizontalIcon className="h-5 w-5 shrink-0" />
          <span>Više</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-52">
        {MORE_ITEMS.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link to={item.to} className="flex w-full cursor-pointer items-center gap-2">
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="flex w-full cursor-pointer items-center gap-2">
            <Cog6ToothIcon className="h-4 w-4" />
            <span>Podešavanja</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
