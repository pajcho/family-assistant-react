import { useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useKidPreview } from "@/hooks/useKidPreview";
import { readKidClaims } from "@/types/kid";

/**
 * Whose kid shell is this, and is it real?
 *
 * Two answers in one hook, and keeping them apart is the point:
 *
 *   - A real kid session, read from the claims baked into the synthetic auth
 *     user's `app_metadata` at provision time - no query, no round trip,
 *     available on the very first render. That is what lets both layout guards
 *     (`_app` sending kids to `/kid`, `kid` sending grown-ups to `/`) decide
 *     without a loading flash.
 *   - A grown-up previewing a child (`/kid/pregled`). It takes precedence over
 *     the claims - a real kid can never be inside a preview - and supplies the
 *     same `kidProfileId` every kid screen already filters by, which is what
 *     lets those screens be reused verbatim.
 *
 * `isKid` stays FALSE in preview on purpose. It answers "is this session a
 * child's", and a parent's session is not, however it is being rendered:
 * anything that writes, or that reads the kid's own `kid_access` row, must keep
 * seeing the truth. `isPreview` is the flag for "draw it as the child sees it".
 *
 * NOT a security boundary. RLS is: every kid policy re-resolves the child
 * through `public.kid_profile_id()`, which itself re-checks `is_enabled`, so a
 * revoked child holding a still-valid JWT sees nothing. And because a parent's
 * session is NOT narrowed by those policies, the preview relies on the kid
 * screens filtering to `kidProfileId` in code rather than on RLS.
 */
export interface KidSession {
  /** True only for a real, signed-in child. Never true in preview. */
  isKid: boolean;
  /** True while a grown-up is looking at a child's app from their own session. */
  isPreview: boolean;
  /** The child's ORIGINAL `profiles.id` - not `auth.uid()`. */
  kidProfileId: string | null;
  familyId: string | null;
  /** The synthetic auth user's id - the key `kid_access` is looked up by. Null in preview. */
  authUserId: string | null;
}

export function useKidSession(): KidSession {
  const { user } = useAuth();
  const preview = useKidPreview();

  return useMemo(() => {
    if (preview) {
      return {
        isKid: false,
        isPreview: true,
        kidProfileId: preview.previewProfileId,
        familyId: preview.familyId,
        authUserId: null,
      };
    }
    const claims = readKidClaims(user?.app_metadata);
    if (!claims || !user) {
      return {
        isKid: false,
        isPreview: false,
        kidProfileId: null,
        familyId: null,
        authUserId: null,
      };
    }
    return {
      isKid: true,
      isPreview: false,
      kidProfileId: claims.kid_profile_id,
      familyId: claims.family_id,
      authUserId: user.id,
    };
  }, [preview, user]);
}
