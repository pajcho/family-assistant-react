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
  PlusIcon,
  RectangleGroupIcon,
  SunIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { AppNavLink } from "@/components/layout/AppNavLink";
import {
  FIXED_SECTION,
  MAX_FREE_SLOTS,
  NAV_SECTIONS,
  NAV_SECTION_MAP,
  UNSLOTTABLE_SECTIONS,
  normalizeNavSlots,
  sectionForPathname,
  type NavSection,
  type NavSectionKey,
} from "@/components/layout/navSections";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { GlobalAddSheet } from "@/components/common/GlobalAddSheet";
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
import { useSearchDialog } from "@/hooks/useSearchDialog";
import { useIsKeyboardOpen } from "@/hooks/useIsKeyboardOpen";
import { useProfile, useUpdateNavSlots } from "@/hooks/useProfile";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { readNavRecents, recordNavRecent } from "@/lib/navRecents";
import { getDisplayName } from "@/utils/identity";

/**
 * App chrome (redizajn 2.0).
 *
 * Below `lg` there is no top bar at all - every screen owns its own header
 * (title, filters, search and avatar buttons), which is what lets the frame be
 * a fixed 100dvh box with per-screen scrolling. Navigation is the bottom bar:
 *
 *     Danas · [slot] · (+) · [slot] · Meni
 *
 * Danas and Meni are fixed, the two middle slots are the user's own picks
 * (`profiles.nav_slots`, normalized through {@link normalizeNavSlots} which
 * also maps pre-redesign keys forward), and the centre "+" opens the global
 * add sheet - the FAB that used to float over every page is gone.
 *
 * At `lg` and up the desktop header carries the sections inline. (Lane H of
 * the redesign replaces it with a sidebar; this keeps desktop usable until
 * then.)
 */

export function AppNav() {
  const { openSearch } = useSearchDialog();

  // Feed the "Nedavno" row: every visit to one of the sections is remembered
  // per-device, whatever surface triggered the navigation.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const key = sectionForPathname(pathname);
    if (key) recordNavRecent(key);
  }, [pathname]);

  return (
    <nav className="hidden flex-none border-b border-border bg-card lg:block">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2" aria-label="Početna">
            {/* The brand mark stays blue whatever accent the user picked -
                it matches the PWA icon, the login screen and the splash. */}
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
              <UserGroupIcon className="h-5 w-5 text-white" />
            </div>
          </Link>
          <div className="flex gap-1">
            {NAV_SECTIONS.filter((section) => !section.search && section.key !== "settings").map(
              (section) => (
                <AppNavLink
                  key={section.key}
                  to={section.to}
                  label={section.label}
                  icon={section.icon}
                />
              ),
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Pretraga"
            title="Pretraga (⌘K)"
            onClick={openSearch}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <MagnifyingGlassIcon className="h-5 w-5" />
          </button>
          <AppMenu />
        </div>
      </div>
    </nav>
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

  return (
    <AppDropdownMenu
      identity={identity}
      displayName={getDisplayName(identity)}
      email={user?.email ?? null}
      mode={mode}
      setMode={setMode}
      onLogout={handleLogout}
    />
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
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pr-1.5 pl-0.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
        >
          <UserAvatar {...identity} className="h-8 w-8" />
          <span className="max-w-[12rem] truncate text-sm font-medium">{displayName}</span>
          <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <UserAvatar {...identity} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{displayName}</div>
            {email && displayName !== email ? (
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            ) : null}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Tema
        </DropdownMenuLabel>
        <div className="px-2 py-1.5">
          <ThemePickerRow mode={mode} onSelect={setMode} />
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
    <div className="flex w-full items-center gap-1 rounded-md bg-muted p-1">
      <ThemeButton
        active={mode === "light"}
        onClick={() => onSelect("light")}
        ariaLabel="Svetla tema"
        activeColor="text-warn"
        icon={SunIcon}
      />
      <ThemeButton
        active={mode === "dark"}
        onClick={() => onSelect("dark")}
        ariaLabel="Tamna tema"
        activeColor="text-accent-deep"
        icon={MoonIcon}
      />
      <ThemeButton
        active={mode === "auto"}
        onClick={() => onSelect("auto")}
        ariaLabel="Automatska tema"
        activeColor="text-foreground"
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
        "flex flex-1 items-center justify-center rounded-sm p-1.5 transition-colors",
        active
          ? cn("bg-card shadow-sm", activeColor)
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/* ────────────────────────── donja traka (< lg) ────────────────────────── */

export function MobileBottomNav() {
  // iOS Safari auto-elevates the keyboard above page content and leaves the
  // bar sandwiched between the form and the keyboard; unmounting it is the
  // one reliable fix (see useIsKeyboardOpen).
  const keyboardOpen = useIsKeyboardOpen();
  const { profile } = useProfile();
  const [addOpen, setAddOpen] = useState(false);
  // Until the profile loads this renders the default layout - same bar every
  // new user sees, so there's no blank state, just a quick swap for the few
  // who customized.
  const slots = useMemo(() => normalizeNavSlots(profile?.nav_slots), [profile]);

  if (keyboardOpen) return null;

  const fixed = NAV_SECTION_MAP[FIXED_SECTION];
  const [left, right] = [slots[0], slots[1]];

  return (
    <nav
      // A flex sibling of the screen area, not a `position: fixed` overlay:
      // the frame doesn't scroll, so the bar simply takes its own space (plus
      // the home-indicator inset) and nothing has to reserve room for it.
      // Opaque, no backdrop-filter - iOS fails to repaint blurred bars.
      className="relative z-30 flex flex-none items-start gap-1 border-t border-border bg-card px-2 pt-2 pb-[calc(0.375rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      <BottomTab section={fixed} />
      {left ? <BottomTab section={NAV_SECTION_MAP[left]} /> : <span className="flex-1" />}

      <button
        type="button"
        aria-label="Dodaj"
        onClick={() => setAddOpen(true)}
        className="-mt-3.5 flex size-[54px] flex-none items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-[0_10px_22px_-8px_var(--accent)] transition-transform active:scale-90"
      >
        <PlusIcon className="size-6" />
      </button>

      {right ? <BottomTab section={NAV_SECTION_MAP[right]} /> : <span className="flex-1" />}
      <MeniSheet slots={slots} />

      <GlobalAddSheet open={addOpen} onOpenChange={setAddOpen} />
    </nav>
  );
}

function BottomTab({ section }: { section: NavSection }) {
  return (
    <AppNavLink
      to={section.to}
      search={section.search}
      label={section.label}
      icon={section.icon}
      className="flex-1"
    />
  );
}

type MeniView = "root" | "edit";

/**
 * "Meni" - the last bar slot. The root view is the map of the whole app
 * (Nedavno + every section); "Uredi traku" pushes the slot editor onto the
 * same sheet. The trigger stays highlighted while the current route is a
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
      !section.search &&
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

  const slottable = NAV_SECTIONS.filter((section) => !UNSLOTTABLE_SECTIONS.includes(section.key));

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
          "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-extrabold transition-colors",
          isMoreRoute ? "text-accent-deep" : "text-muted-foreground",
        )}
      >
        <RectangleGroupIcon className="size-[21px] shrink-0" />
        <span>Meni</span>
      </button>
      <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-md">
          {view === "root" ? (
            <>
              <SheetStackHeader title="Meni" />
              {recents.length > 0 ? (
                <div className="mb-3">
                  <p className="mb-2 text-[11.5px] font-extrabold tracking-wider text-muted-foreground uppercase">
                    Nedavno
                  </p>
                  <div className="flex gap-1.5 overflow-x-auto">
                    {recents.map((key) => {
                      const section = NAV_SECTION_MAP[key];
                      return (
                        <Link
                          key={key}
                          to={section.to}
                          search={section.search}
                          onClick={close}
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-bold"
                        >
                          <section.icon className="size-4 text-muted-foreground" />
                          <span>{section.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                {NAV_SECTIONS.map((section) => (
                  <SectionTile key={`${section.key}`} section={section} onNavigate={close} />
                ))}
              </div>
              <button
                type="button"
                onClick={() => push("edit")}
                className="mt-3 flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 text-left text-sm font-bold transition-transform active:scale-[0.98]"
              >
                <PencilSquareIcon className="size-[17px] text-muted-foreground" />
                <span className="flex-1">
                  Uredi traku
                  <span className="block text-xs font-semibold text-muted-foreground">
                    Danas je uvek prvo mesto · {MAX_FREE_SLOTS} slobodna slota
                  </span>
                </span>
              </button>
            </>
          ) : (
            <>
              <SheetStackHeader
                title="Uredi traku"
                onBack={pop}
                description={`Danas i Meni su uvek u traci, plus (+) je u sredini. Izaberi ${MAX_FREE_SLOTS} stavke za slobodna mesta - sve ostalo ostaje u meniju.`}
              />
              <p className="mb-2 text-xs font-bold text-muted-foreground" aria-live="polite">
                Izabrano: {slots.length}/{MAX_FREE_SLOTS}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {slottable.map((section) =>
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

/** Shared tile chrome for the Meni grid and the slot editor. */
function tileClass(active: boolean): string {
  return cn(
    "relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3.5 text-xs font-bold transition-colors",
    active ? "border-accent bg-accent-soft text-accent-deep" : "border-border bg-card",
  );
}

/** Root-view tile: navigates and closes the sheet. */
function SectionTile({ section, onNavigate }: { section: NavSection; onNavigate: () => void }) {
  const matchRoute = useMatchRoute();
  const active =
    section.to === "/"
      ? !!matchRoute({ to: "/" })
      : !section.search && !!matchRoute({ to: section.to, fuzzy: true });

  return (
    <Link
      to={section.to}
      search={section.search}
      onClick={onNavigate}
      className={tileClass(active)}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-md",
          active ? "bg-accent text-accent-foreground" : "bg-accent-soft text-accent-deep",
        )}
      >
        <section.icon className="size-5" />
      </span>
      {section.label}
    </Link>
  );
}

/** Editor tile for "Danas" - informative only, never leaves the bar. */
function FixedSlotTile({ section }: { section: NavSection }) {
  return (
    <div
      className={cn(tileClass(false), "opacity-60")}
      aria-label={`${section.label} je uvek u traci`}
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <LockClosedIcon className="size-5" />
      </span>
      {section.label}
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
      className={tileClass(selected)}
    >
      <span
        className={cn(
          "absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-accent bg-accent text-accent-foreground"
            : "border-border bg-card text-transparent",
        )}
      >
        <CheckIcon className="size-3" />
      </span>
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-md",
          selected ? "bg-accent text-accent-foreground" : "bg-accent-soft text-accent-deep",
        )}
      >
        <section.icon className="size-5" />
      </span>
      {section.label}
    </button>
  );
}
