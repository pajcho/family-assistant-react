import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { getInitials, gravatarHash, gravatarUrl, type IdentityInput } from "@/utils/identity";

/**
 * Round user avatar with two layers:
 *
 *  - Initials sit underneath as the always-present fallback (so there is
 *    no transparent gap while we resolve / load the Gravatar image).
 *  - A Gravatar `<img>` layers on top once we have a hash. We request
 *    Gravatar with `d=404`, so if the email has no avatar registered the
 *    request 404s, `onError` fires and we hide the img - initials stay
 *    visible. Same fallback path covers network errors.
 *
 * The image renders at 2× the displayed pixel size for crisp HiDPI
 * rendering. The component is purely visual - wrap it in a button at the
 * call site if you need it to trigger something.
 */

interface UserAvatarProps extends IdentityInput {
  /** Tailwind size - applied as both width and height. Default 36px (h-9 w-9). */
  className?: string;
  /** Pixel size requested from Gravatar (defaults to 80). */
  gravatarSize?: number;
}

export function UserAvatar({
  firstName,
  lastName,
  email,
  className,
  gravatarSize = 80,
}: UserAvatarProps) {
  const initials = getInitials({ firstName, lastName, email });
  // The resolved URL is stored with the input it belongs to, so a stale one
  // (email or size changed, hash still pending) is ignored during render
  // instead of being cleared from an effect. A failure is tied to that exact
  // result object, so a fresh resolve always gets a new attempt.
  const requestKey = JSON.stringify([email ?? null, gravatarSize]);
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<{ key: string; url: string } | null>(null);
  const current = resolved?.key === requestKey ? resolved : null;
  const imgUrl = current && current !== failed ? current.url : null;

  useEffect(() => {
    let cancelled = false;
    const e = (email ?? "").trim();
    if (!e) return;
    const key = JSON.stringify([email ?? null, gravatarSize]);
    void gravatarHash(e).then((hash) => {
      if (cancelled || !hash) return;
      setResolved({ key, url: gravatarUrl(hash, gravatarSize) });
    });
    return () => {
      cancelled = true;
    };
  }, [email, gravatarSize]);

  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-blue-600 text-sm font-normal text-white dark:bg-blue-500",
        className,
      )}
      aria-hidden="true"
    >
      <span>{initials}</span>
      {imgUrl ? (
        <img
          src={imgUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(current)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
