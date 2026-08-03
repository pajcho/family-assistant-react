import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightOnRectangleIcon,
  BellIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
  SwatchIcon,
  UserCircleIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { getDisplayName } from "@/utils/identity";

/**
 * Full-screen profile hub - what the avatar in the top header opens below
 * `lg` instead of the desktop dropdown (a dropdown is cramped on touch).
 * Identity up top, then the theme picker and links into the settings tabs,
 * with logout at the bottom. Reachable on desktop too via direct URL - it
 * renders as a centered column, no redirect needed.
 */
export const Route = createFileRoute("/_app/profile")({
  component: ProfilePage,
});

const SETTINGS_LINKS = [
  { label: "Lični podaci", icon: UserCircleIcon, search: {} },
  { label: "Porodica", icon: UserGroupIcon, search: { tab: "family" as const } },
  { label: "Obaveštenja", icon: BellIcon, search: { tab: "notifications" as const } },
  { label: "Kalendar", icon: CalendarDaysIcon, search: { tab: "calendar" as const } },
];

function ProfilePage() {
  const { signOut, user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();

  const identity = {
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    email: user?.email ?? null,
  };
  const displayName = getDisplayName(identity);

  const handleLogout = async () => {
    await signOut();
    await navigate({ to: "/login" });
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-4 px-1 py-2">
        <UserAvatar {...identity} className="h-16 w-16 text-xl" gravatarSize={160} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-gray-900 dark:text-gray-100">
            {displayName}
          </h1>
          {user?.email && displayName !== user.email ? (
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
          ) : null}
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <SwatchIcon className="size-5 text-blue-600 dark:text-blue-400" />
          Izgled
        </h2>
        <ThemeSegmented className="mt-3" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {SETTINGS_LINKS.map(({ label, icon: Icon, search }) => (
            <li key={label}>
              <Link
                to="/settings"
                search={search}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset dark:hover:bg-gray-700/40"
              >
                <Icon className="size-5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {label}
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-gray-300 dark:text-gray-600" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Same card anatomy as the settings links above - the logout is a row
          of the card, not a second frame floating on the page background. */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex w-full items-center justify-center gap-2 px-4 py-3.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none focus-visible:ring-inset dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <ArrowRightOnRectangleIcon className="size-5" />
          Odjavi se
        </button>
      </section>

      <p className="pt-1 pb-3 text-center text-sm text-gray-400 dark:text-gray-500">
        Porodični asistent
      </p>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Svetla", icon: SunIcon },
  { value: "dark", label: "Tamna", icon: MoonIcon },
  { value: "auto", label: "Auto", icon: ComputerDesktopIcon },
];

/**
 * The Svetla/Tamna/Auto segmented control - same pill pattern as the header
 * dropdown's ThemePickerRow, but sized for a page: icon + label per option.
 */
function ThemeSegmented({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-700/60",
        className,
      )}
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setMode(value)}
          aria-pressed={mode === value}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
            mode === value
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
