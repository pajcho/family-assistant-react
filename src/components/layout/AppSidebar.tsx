import { useState } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
  ComputerDesktopIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import { GlobalAddSheet } from "@/components/common/GlobalAddSheet";
import { NAV_SECTIONS, type NavSection } from "@/components/layout/navSections";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useSearchDialog } from "@/hooks/useSearchDialog";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { getDisplayName } from "@/utils/identity";

/**
 * Desktop navigation (>= lg): a 240px rail instead of the old inline top row.
 *
 * The bar at the top of the window was a mobile pattern stretched wide - eight
 * items squeezed into a single row with the account menu fighting them for
 * space. A rail has room for every section at once, so nothing hides behind a
 * "Meni" sheet on a screen that has space to spare, and it frees the top of the
 * page for the screen's own header.
 *
 * "Dodaj" leads with the same global add sheet as the "+" in the mobile bar -
 * one entry point for adding anything, on both form factors.
 *
 * Below `lg` this renders nothing; the bottom bar takes over (unchanged
 * breakpoint - the desktop rail plus a screen's two columns needs the width).
 */
export function AppSidebar() {
  const { profile, familyName } = useProfile();
  const { user } = useAuth();
  const { mode, setMode } = useTheme();
  const { openSearch } = useSearchDialog();
  const [addOpen, setAddOpen] = useState(false);

  const identity = {
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    email: user?.email ?? null,
  };

  return (
    <aside className="hidden w-60 flex-none flex-col gap-3.5 border-r border-border bg-card p-3 lg:flex">
      <Link to="/" className="flex items-center gap-2.5 px-1" aria-label="Danas">
        {/* The mark stays blue whatever accent the user picked - it is the same
            identity as the PWA icon, the login screen and the splash. */}
        <span className="grid size-[34px] flex-none place-items-center rounded-md bg-blue-600 text-white">
          <UserGroupIcon className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] leading-tight font-extrabold tracking-tight">
            {familyName ?? "Porodični asistent"}
          </span>
          <span className="block text-[11.5px] font-semibold text-muted-foreground">
            Porodični asistent
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="flex h-[42px] items-center justify-center gap-2 rounded-lg bg-accent text-[14.5px] font-extrabold text-accent-foreground shadow-[0_8px_18px_-10px_var(--accent)] transition-transform active:scale-[0.98]"
      >
        <PlusIcon className="size-[18px]" />
        Dodaj
      </button>

      {/* Search lives here as well as in each screen's header: the rail is the
          one surface present on every screen, and ⌘K alone is undiscoverable. */}
      <button
        type="button"
        onClick={openSearch}
        className="flex h-9 items-center gap-2 rounded-md border border-border px-2.5 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <MagnifyingGlassIcon className="size-[15px]" />
        Pretraži
        <kbd className="ml-auto rounded-sm border border-border px-1.5 py-px font-mono text-[10.5px]">
          ⌘K
        </kbd>
      </button>

      <nav className="grid gap-0.5">
        {NAV_SECTIONS.map((section, index) => (
          <SidebarLink
            key={section.key}
            section={section}
            // Porodica and Podešavanja are account-level, not day-to-day
            // destinations - a hairline sets them apart without hiding them.
            separated={section.key === "family" && index > 0}
          />
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2 rounded-md border border-border p-2">
        <Link
          to="/settings"
          aria-label="Profil i podešavanja"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <UserAvatar {...identity} className="size-[30px] flex-none rounded-md" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">
              {getDisplayName(identity) || "Profil"}
            </span>
            <span className="block truncate text-[11px] font-semibold text-muted-foreground">
              {user?.email ?? ""}
            </span>
          </span>
        </Link>
        <ThemeMini mode={mode} onSelect={setMode} />
      </div>

      <GlobalAddSheet open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  );
}

function SidebarLink({ section, separated }: { section: NavSection; separated: boolean }) {
  const matchRoute = useMatchRoute();
  const active =
    section.to === "/"
      ? !!matchRoute({ to: "/" })
      : !section.search && !!matchRoute({ to: section.to, fuzzy: true });

  return (
    <>
      {separated ? <span className="mx-2 my-1.5 h-px bg-border" /> : null}
      <Link
        to={section.to}
        search={section.search}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold transition-colors",
          active
            ? "bg-accent-soft font-extrabold text-accent-deep"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <section.icon className="size-[19px] flex-none" />
        {section.label}
      </Link>
    </>
  );
}

/** Compact light/dark/auto switch - the rail's footer has no room for labels. */
function ThemeMini({ mode, onSelect }: { mode: ThemeMode; onSelect: (next: ThemeMode) => void }) {
  const options: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
    { value: "light", label: "Svetla tema", icon: SunIcon },
    { value: "dark", label: "Tamna tema", icon: MoonIcon },
    { value: "auto", label: "Automatska tema", icon: ComputerDesktopIcon },
  ];

  return (
    <div className="flex flex-none gap-0.5 rounded-md bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={mode === option.value}
          onClick={() => onSelect(option.value)}
          className={cn(
            "grid size-6 place-items-center rounded-sm transition-colors",
            mode === option.value
              ? "bg-card text-accent-deep shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon className="size-[13px]" />
        </button>
      ))}
    </div>
  );
}
