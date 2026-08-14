import { useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  CheckIcon,
  LockClosedIcon,
  PencilSquareIcon,
  PlusIcon,
  RectangleGroupIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { AppNavLink } from "@/components/layout/AppNavLink";
import {
  FIXED_SECTION,
  MAX_FREE_SLOTS,
  MENU_GRID_SECTIONS,
  NAV_SECTIONS,
  NAV_SECTION_MAP,
  UNSLOTTABLE_SECTIONS,
  isNavSectionActive,
  normalizeNavSlots,
  type NavSection,
  type NavSectionKey,
} from "@/components/layout/navSections";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { useAppCommands } from "@/hooks/useAppCommands";
import { useProfile, useUpdateNavSlots } from "@/hooks/useProfile";
import { readNavRecents } from "@/lib/navRecents";

/**
 * Mobile navigation (< lg), redizajn 2.0.
 *
 * There is no top bar any more - every screen owns its own header (title,
 * filters, search and avatar buttons), which is what lets the frame be a fixed
 * 100dvh box with per-screen scrolling. Navigation is the bottom bar:
 *
 *     Danas · [slot] · (+) · [slot] · Meni
 *
 * Danas and Meni are fixed, the two middle slots are the user's own picks
 * (`profiles.nav_slots`, normalized through {@link normalizeNavSlots} which
 * also maps pre-redesign keys forward), and the centre "+" opens the global
 * add sheet - the FAB that used to float over every page is gone.
 *
 * At `lg` and up this renders nothing; <AppSidebar> takes over.
 */

export function MobileBottomNav() {
  const { openAdd } = useAppCommands();
  const { profile } = useProfile();
  // Until the profile loads this renders the default layout - same bar every
  // new user sees, so there's no blank state, just a quick swap for the few
  // who customized.
  const slots = useMemo(() => normalizeNavSlots(profile?.nav_slots), [profile]);

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
        onClick={openAdd}
        className="-mt-3.5 flex size-[54px] flex-none items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-[0_10px_22px_-8px_var(--accent)] transition-transform active:scale-90"
      >
        <PlusIcon className="size-6" />
      </button>

      {right ? <BottomTab section={NAV_SECTION_MAP[right]} /> : <span className="flex-1" />}
      <MenuSheet slots={slots} />
    </nav>
  );
}

function BottomTab({ section }: { section: NavSection }) {
  return <AppNavLink section={section} className="flex-1" />;
}

type MenuView = "root" | "edit";

/**
 * "Meni" - the last bar slot. The root view is the map of the whole app
 * (Nedavno + every section); "Uredi traku" pushes the slot editor onto the
 * same sheet. The trigger stays highlighted while the current route is a
 * section that is NOT in the bar, mirroring Todoist's "Browse".
 */
function MenuSheet({ slots }: { slots: NavSectionKey[] }) {
  const [open, setOpen] = useState(false);
  const stack = useSheetStack<MenuView>(open, setOpen, "root");
  const { pop, push } = stack;
  const { pathname, search } = useLocation();
  const updateNavSlots = useUpdateNavSlots();

  const isMoreRoute = NAV_SECTIONS.some(
    (section) =>
      section.key !== FIXED_SECTION &&
      !slots.includes(section.key) &&
      isNavSectionActive(section, pathname, search),
  );

  // Re-read on every open - visits are recorded globally (in the _app route), the
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
          "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-bold transition-colors",
          isMoreRoute ? "text-accent-deep" : "text-muted-foreground",
        )}
      >
        <RectangleGroupIcon className="size-[21px] shrink-0" />
        <span>Meni</span>
      </button>
      <SheetStackViews
        stack={stack}
        render={(view) => (
          <ResponsiveDialogContent className="sm:max-w-md">
            {view === "root" ? (
              <>
                <SheetStackHeader title="Meni" />
                {recents.length > 0 ? (
                  <div className="mb-3">
                    <p className="mb-2 text-[11.5px] font-bold tracking-wider text-muted-foreground uppercase">
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
                            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold"
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
                  {MENU_GRID_SECTIONS.map((section) => (
                    <SectionTile key={`${section.key}`} section={section} onNavigate={close} />
                  ))}
                </div>
                {/* Podešavanja sits under the grid rather than in it - see
                    MENU_GRID_SECTIONS for why. */}
                <SettingsRow onNavigate={close} />
                <button
                  type="button"
                  onClick={() => push("edit")}
                  className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 text-left text-sm font-semibold transition-transform active:scale-[0.98]"
                >
                  <PencilSquareIcon className="size-[17px] text-muted-foreground" />
                  <span className="flex-1">
                    Uredi traku
                    <span className="block text-xs font-normal text-muted-foreground">
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
                <p className="mb-2 text-xs font-semibold text-muted-foreground" aria-live="polite">
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
        )}
      />
    </>
  );
}

/**
 * Settings as a full-width row under the grid - same chrome as the edit
 * traku", so the two read as the menu's own footer rather than as a tile that
 * fell out of the grid.
 */
function SettingsRow({ onNavigate }: { onNavigate: () => void }) {
  const section = NAV_SECTION_MAP.settings;
  const { pathname, search } = useLocation();
  const active = isNavSectionActive(section, pathname, search);
  const Icon = section.icon;

  return (
    <Link
      to={section.to}
      onClick={onNavigate}
      className={cn(
        "mt-3 flex w-full items-center gap-2.5 rounded-lg border px-3.5 py-3 text-left text-sm font-semibold transition-transform active:scale-[0.98]",
        active ? "border-accent bg-accent-soft text-accent-deep" : "border-border bg-card",
      )}
    >
      <Icon className={cn("size-[17px]", active ? "text-accent-deep" : "text-muted-foreground")} />
      <span className="flex-1">{section.label}</span>
    </Link>
  );
}

/** Shared tile chrome for the Meni grid and the slot editor. */
function tileClass(active: boolean): string {
  return cn(
    "relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3.5 text-xs font-semibold transition-colors",
    active ? "border-accent bg-accent-soft text-accent-deep" : "border-border bg-card",
  );
}

/** Root-view tile: navigates and closes the sheet. */
function SectionTile({ section, onNavigate }: { section: NavSection; onNavigate: () => void }) {
  const { pathname, search } = useLocation();
  const active = isNavSectionActive(section, pathname, search);

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
