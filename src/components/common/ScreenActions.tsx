import { Link } from "@tanstack/react-router";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import { IconButton } from "@/components/common/IconButton";
import { searchShortcutLabel } from "@/lib/platform";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useSearchDialog } from "@/hooks/useSearchDialog";

/**
 * The two chrome controls a top-level screen header carries on the right
 * (redizajn 2.0 moved the app bar into the screens themselves, so every screen
 * repeats them): global search, and the avatar as the way into settings.
 *
 * They live together so Danas, Kalendar and Novac stay pixel-identical.
 */

export function SearchIconButton() {
  const { openSearch } = useSearchDialog();
  return (
    <IconButton
      icon={MagnifyingGlassIcon}
      aria-label="Pretraga"
      title={`Pretraga (${searchShortcutLabel()})`}
      onClick={openSearch}
    />
  );
}

/** Avatar button - opens settings (profile, family, notifications, theme). */
export function ProfileAvatarLink() {
  const { user } = useAuth();
  const { profile } = useProfile();

  return (
    <Link
      to="/settings"
      aria-label="Podešavanja"
      // Matches the IconButton's 40px tile and 44px tap target so the two sit
      // level in the header row.
      className="relative flex size-10 shrink-0 items-center justify-center rounded-md transition-transform after:absolute after:-inset-0.5 after:content-[''] active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:active:scale-100"
    >
      <UserAvatar
        firstName={profile?.first_name ?? null}
        lastName={profile?.last_name ?? null}
        email={user?.email ?? null}
        className="size-[38px] rounded-md"
      />
    </Link>
  );
}
