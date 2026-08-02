import { useEffect, useMemo, useState } from "react";
import { Link, useMatchRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowRightOnRectangleIcon,
  CheckIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PencilSquareIcon,
  RectangleGroupIcon,
  SunIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { AppNavLink } from "@/components/layout/AppNavLink";
import {
  DESKTOP_SECTIONS,
  FIXED_SECTION,
  MAX_FREE_SLOTS,
  NAV_SECTIONS,
  NAV_SECTION_MAP,
  normalizeNavSlots,
  sectionForPathname,
  type NavSection,
  type NavSectionKey,
} from "@/components/layout/navSections";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useIsKeyboardOpen } from "@/hooks/useIsKeyboardOpen";
import { useProfile, useUpdateNavSlots } from "@/hooks/useProfile";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { readNavRecents, recordNavRecent } from "@/lib/navRecents";
import { getDisplayName } from "@/utils/identity";

/**
 * App chrome.
 *
 * Desktop (>= lg): top sticky header with logo + the full inline nav + the
 * account dropdown (theme / settings / logout). No bottom bar.
 *
 * Mobile + tablet (< lg): top header is logo + search + the avatar, which
 * navigates to the full-screen /profile page (no dropdown on touch).
 * Navigation lives in a fixed bottom tab bar - "Danas" is always the first
 * slot, the next three are the user's own picks (`profiles.nav_slots`,
 * normalized through {@link normalizeNavSlots}), and the fifth is "Meni".
 *
 * "Meni" opens a sheet that is the map of the whole app: a "Nedavno" row
 * (per-device, sections not already in the bar) + a tile grid of ALL nine
 * sections in a fixed order, so positions can be learned. From there,
 * "Uredi traku" pushes an editor sub-view onto the same sheet (the
 * `useSheetStack` convention - "←" back, dismissal pops one level) where
 * toggling tiles applies to the bar live via an optimistic profile update.
 *
 * The breakpoint is `lg` (1024px), not `md`: the desktop row carries 8 items,
 * which is tight at 768px - so tablets keep the bottom bar.
 *
 * The bottom bar uses `padding: env(safe-area-inset-bottom)` so it doesn't
 * collide with the iPhone home indicator when running as an installed PWA.
 */

export function AppNav() {
  // Global search: ⌘/Ctrl+K toggles, the magnifying-glass button opens.
  const [searchOpen, setSearchOpen] = useState(false);

  // Feed the "Nedavno" row: every visit to one of the nine sections is
  // remembered per-device, whatever surface triggered the navigation.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const key = sectionForPathname(pathname);
    if (key) recordNavRecent(key);
  }, [pathname]);

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
              {DESKTOP_SECTIONS.map((section) => (
                <AppNavLink
                  key={section.key}
                  to={section.to}
                  label={section.label}
                  icon={section.icon}
                />
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
  const matchRoute = useMatchRoute();
  const onProfile = !!matchRoute({ to: "/profile" });

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
    <>
      {/* Below lg the avatar navigates to the full-screen /profile page -
          a dropdown is cramped on touch, and the page has room for the
          theme picker + settings links. Ring marks "you are here". */}
      <Link
        to="/profile"
        aria-label="Profil"
        className={cn(
          "flex size-9 items-center justify-center rounded-full transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98] lg:hidden dark:hover:bg-gray-800",
          onProfile &&
            "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-800",
        )}
      >
        <UserAvatar {...identity} className="h-8 w-8" />
      </Link>
      <div className="hidden lg:block">
        <AppDropdownMenu
          identity={identity}
          displayName={displayName}
          email={user?.email ?? null}
          mode={mode}
          setMode={setMode}
          onLogout={handleLogout}
        />
      </div>
    </>
  );
}

interface AppDropdownMenuProps {
  identity: { firstName: string | null; lastName: string | null; email: string | null };
  displayName: string;
  email: string | null;
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
  onLogout: () => Promise<void>;
}

/** Desktop (lg+) account dropdown: identity, theme pill, settings, logout. */
function AppDropdownMenu({
  identity,
  displayName,
  email,
  mode,
  setMode,
  onLogout,
}: AppDropdownMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Korisnički meni"
          // Avatar doubles as the dropdown trigger - visually distinct from
          // a hamburger so the affordance reads as "your account / menu".
          // The chevron is the explicit "this opens a dropdown" hint.
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pr-1.5 pl-0.5 text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-900"
        >
          <UserAvatar {...identity} className="h-8 w-8" />
          <span className="max-w-[12rem] truncate text-sm font-medium">{displayName}</span>
          <ChevronDownIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <UserAvatar {...identity} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {displayName}
            </div>
            {email && displayName !== email ? (
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">{email}</div>
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
        {/* Page links aren't repeated here - the bottom bar + "Meni" sheet
            cover navigation below lg, and the top row covers it at lg+. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="flex w-full cursor-pointer items-center gap-2">
            <Cog6ToothIcon className="h-4 w-4" />
            <span>Podešavanja</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void onLogout();
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
  // iOS Safari auto-elevates `position: fixed` elements above the on-screen
  // keyboard, so the nav ends up sandwiched between the form and the keyboard.
  // We outright unmount it while the keyboard is open (see useIsKeyboardOpen).
  const keyboardOpen = useIsKeyboardOpen();
  const { profile } = useProfile();
  // Until the profile loads this renders the default layout - same bar every
  // new user sees, so there's no blank state, just a quick swap for the few
  // who customized.
  const slots = useMemo(() => normalizeNavSlots(profile?.nav_slots), [profile]);

  if (keyboardOpen) return null;

  const fixed = NAV_SECTION_MAP[FIXED_SECTION];

  return (
    <nav
      // `pb-[env(safe-area-inset-bottom)]` keeps the row above the iPhone
      // home indicator when launched from the home screen as a PWA. Opaque
      // background (no backdrop-blur) for the same iOS repaint reason as the
      // top header - a fixed `backdrop-filter` bar flickers during scroll.
      className="fixed right-0 bottom-0 left-0 z-30 border-t border-gray-200/80 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden dark:border-gray-700/80 dark:bg-gray-800"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5 pb-1.5">
        <AppNavLink
          to={fixed.to}
          label={fixed.label}
          icon={fixed.icon}
          className="flex-1 text-xs"
        />
        {slots.map((key) => {
          const section = NAV_SECTION_MAP[key];
          return (
            <AppNavLink
              key={key}
              to={section.to}
              label={section.label}
              icon={section.icon}
              className="flex-1 text-xs"
            />
          );
        })}
        <MeniSheet slots={slots} />
      </div>
    </nav>
  );
}

type MeniView = "root" | "edit";

/**
 * "Meni" - the fifth bar slot. The root view is the map of the whole app
 * (Nedavno + all nine sections); "Uredi traku" pushes the slot editor onto
 * the same sheet. The trigger stays highlighted while the current route is a
 * section that is NOT in the bar, mirroring Todoist's "Browse".
 */
function MeniSheet({ slots }: { slots: NavSectionKey[] }) {
  const [open, setOpen] = useState(false);
  const { view, pop, push, dialogOpen, dialogKey, handleOpenChange } = useSheetStack<MeniView>(
    open,
    setOpen,
    "root",
  );
  const matchRoute = useMatchRoute();
  const updateNavSlots = useUpdateNavSlots();

  const isMoreRoute = NAV_SECTIONS.some(
    (section) =>
      section.key !== FIXED_SECTION &&
      !slots.includes(section.key) &&
      !!matchRoute({ to: section.to, fuzzy: true }),
  );

  // Re-read on every open - visits are recorded globally (AppNav effect), the
  // sheet only presents them. Sections already in the bar are one tap away
  // and would be noise here.
  const recents = useMemo(() => {
    if (!open) return [];
    const inBar = new Set<NavSectionKey>([FIXED_SECTION, ...slots]);
    return readNavRecents()
      .filter((key) => !inBar.has(key))
      .slice(0, 3);
  }, [open, slots]);

  const close = () => setOpen(false);

  const toggleSlot = (key: NavSectionKey) => {
    const selected = slots.includes(key);
    if (!selected && slots.length >= MAX_FREE_SLOTS) {
      toast(`Traka je puna (${MAX_FREE_SLOTS}/${MAX_FREE_SLOTS}) - prvo skini neku stavku.`);
      return;
    }
    // Applied live: the optimistic profile update re-renders the bar behind
    // the sheet, so the result is visible while editing.
    updateNavSlots.mutate(selected ? slots.filter((k) => k !== key) : [...slots, key]);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Meni"
        onClick={() => setOpen(true)}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
          isMoreRoute
            ? "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white",
        )}
      >
        <RectangleGroupIcon className="h-5 w-5 shrink-0" />
        <span>Meni</span>
      </button>
      <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-md">
          {view === "root" ? (
            <>
              <SheetStackHeader title="Meni" />
              {recents.length > 0 ? (
                <div className="mb-4">
                  <p className="mb-2 text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    Nedavno
                  </p>
                  <div className="flex gap-2 overflow-x-auto">
                    {recents.map((key) => {
                      const section = NAV_SECTION_MAP[key];
                      return (
                        <Link
                          key={key}
                          to={section.to}
                          onClick={close}
                          className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/40"
                        >
                          <section.icon className={cn("size-4", section.iconClass)} />
                          <span>{section.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                {NAV_SECTIONS.map((section) => (
                  <SectionTile key={section.key} section={section} onNavigate={close} />
                ))}
              </div>
              <button
                type="button"
                onClick={() => push("edit")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/40"
              >
                <PencilSquareIcon className="size-4" />
                Uredi traku
              </button>
            </>
          ) : (
            <>
              <SheetStackHeader
                title="Uredi traku"
                onBack={pop}
                description="Danas je uvek prvo mesto. Izaberi do 3 stavke za traku - sve ostalo ostaje u meniju."
              />
              <p
                className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400"
                aria-live="polite"
              >
                Izabrano: {slots.length}/{MAX_FREE_SLOTS}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {NAV_SECTIONS.map((section) =>
                  section.key === FIXED_SECTION ? (
                    <FixedSlotTile key={section.key} section={section} />
                  ) : (
                    <EditSlotTile
                      key={section.key}
                      section={section}
                      selected={slots.includes(section.key)}
                      onToggle={() => toggleSlot(section.key)}
                    />
                  ),
                )}
              </div>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

/** Root-view tile: navigates and closes the sheet. */
function SectionTile({ section, onNavigate }: { section: NavSection; onNavigate: () => void }) {
  const matchRoute = useMatchRoute();
  const active =
    section.to === "/" ? !!matchRoute({ to: "/" }) : !!matchRoute({ to: section.to, fuzzy: true });

  return (
    <Link
      to={section.to}
      onClick={onNavigate}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border px-2 py-4 transition-colors",
        active
          ? "border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30"
          : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40",
      )}
    >
      <span
        className={cn("flex size-11 items-center justify-center rounded-full", section.iconBgClass)}
      >
        <section.icon className={cn("size-5", section.iconClass)} />
      </span>
      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{section.label}</span>
    </Link>
  );
}

/** Editor tile for "Danas" - informative only, never leaves the bar. */
function FixedSlotTile({ section }: { section: NavSection }) {
  return (
    <div
      className="relative flex flex-col items-center gap-2 rounded-xl border border-gray-200 px-2 py-4 opacity-60 dark:border-gray-700"
      aria-label={`${section.label} je uvek u traci`}
    >
      <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
        <LockClosedIcon className="size-3 text-gray-500 dark:text-gray-300" />
      </span>
      <span
        className={cn("flex size-11 items-center justify-center rounded-full", section.iconBgClass)}
      >
        <section.icon className={cn("size-5", section.iconClass)} />
      </span>
      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{section.label}</span>
    </div>
  );
}

/** Editor tile with a check ring; toggling applies to the bar immediately. */
function EditSlotTile({
  section,
  selected,
  onToggle,
}: {
  section: NavSection;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-xl border px-2 py-4 transition-colors",
        selected
          ? "border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30"
          : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40",
      )}
    >
      <span
        className={cn(
          "absolute top-2 right-2 flex size-5 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500"
            : "border-gray-300 bg-white text-transparent dark:border-gray-600 dark:bg-gray-800",
        )}
      >
        <CheckIcon className="size-3" />
      </span>
      <span
        className={cn("flex size-11 items-center justify-center rounded-full", section.iconBgClass)}
      >
        <section.icon className={cn("size-5", section.iconClass)} />
      </span>
      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{section.label}</span>
    </button>
  );
}
