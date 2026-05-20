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
 *    request 404s, `onError` fires and we hide the img — initials stay
 *    visible. Same fallback path covers network errors.
 *
 * The image renders at 2× the displayed pixel size for crisp HiDPI
 * rendering. The component is purely visual — wrap it in a button at the
 * call site if you need it to trigger something.
 */

interface UserAvatarProps extends IdentityInput {
  /** Tailwind size — applied as both width and height. Default 36px (h-9 w-9). */
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
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImgUrl(null);
    setImgFailed(false);
    const e = (email ?? "").trim();
    if (!e) return;
    void gravatarHash(e).then((hash) => {
      if (cancelled || !hash) return;
      setImgUrl(gravatarUrl(hash, gravatarSize));
    });
    return () => {
      cancelled = true;
    };
  }, [email, gravatarSize]);

  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-blue-600 text-sm font-semibold text-white dark:bg-blue-500",
        className,
      )}
      aria-hidden="true"
    >
      <span>{initials}</span>
      {imgUrl && !imgFailed ? (
        <img
          src={imgUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
