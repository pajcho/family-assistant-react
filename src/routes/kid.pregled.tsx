import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { useKidThemeScope } from "@/components/kid/KidThemeScope";
import { KidFamilyView } from "@/components/kid/KidFamilyView";
import { KidScheduleView } from "@/components/kid/KidScheduleView";
import { KidTodayView } from "@/components/kid/KidTodayView";
import { KidUpcomingView } from "@/components/kid/KidUpcomingView";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useKidAccessList } from "@/hooks/useKidAccess";
import {
  KidPreviewProvider,
  kidPreviewExit,
  type KidPreviewValue,
  type KidTabPath,
} from "@/hooks/useKidPreview";
import { useProfile } from "@/hooks/useProfile";
import { DEFAULT_KID_THEME, normalizeKidTheme } from "@/types/kid";
import { getDisplayName } from "@/utils/identity";

/**
 * Pregled dečije aplikacije - the kid shell, rendered for a parent, as one of
 * their children.
 *
 * The point is the decision it unblocks: kid access is a thing a parent has to
 * turn ON, and nobody should have to turn something on to find out what it is.
 * So this route works BEFORE `kid_access` exists (Ana, no PIN, no device) and
 * after (Vuk, already signed in somewhere) alike.
 *
 * Four tabs, one route. The kid shell's own tabs are four sibling routes, but
 * routing the preview the same way would mean carrying `?dete=` through every
 * link and four more route files that do nothing. Local state instead - and the
 * screens themselves are the very same components `/kid` renders, never copies.
 *
 * What makes it truthful rather than flattering: a parent's session is not
 * narrowed by the kid RLS policies, so every kid screen filters to
 * `kidProfileId` in code. `useKidBirthdayVisibility` + `filterKidAgendaItems`
 * are the two places that matters most, because birthdays have no participants
 * to derive visibility from.
 */
export const Route = createFileRoute("/kid/pregled")({
  // `?dete=<profileId>` - which child to render as. Validated here to a string;
  // whether it is really this parent's child is a data question, answered below
  // against the family roster.
  validateSearch: (search: Record<string, unknown>): { dete?: string } => ({
    dete: typeof search.dete === "string" ? search.dete : undefined,
  }),
  component: KidPreviewRoute,
});

function KidPreviewRoute() {
  const { dete } = Route.useSearch();
  const navigate = useNavigate();
  const { familyId } = useProfile();
  const { members } = useFamilyMembers();
  const { byProfileId } = useKidAccessList();
  const { setPreviewTheme } = useKidThemeScope();

  const [tab, setTab] = useState<KidTabPath>("/kid");

  const member = useMemo(
    () => (dete ? (members.find((candidate) => candidate.id === dete) ?? null) : null),
    [dete, members],
  );

  // Built from the search param, not `member`, so the hook order stays flat
  // while the member is still being resolved. Passed to `navigate` whole - the
  // `search` half is what puts the parent back on Porodica, on this child.
  const exitTo = useMemo(() => kidPreviewExit(dete), [dete]);
  const exit = useCallback(() => {
    void navigate(exitTo);
  }, [navigate, exitTo]);

  // The child's real theme when there is a row to read it from, Okean when
  // there is not (access still off). Painted through `KidThemeScope`, the same
  // in-memory channel the login screen uses - the kid layout owns the actual
  // `data-kid-theme` attribute, and only ever one writer may.
  const storedTheme = dete ? byProfileId.get(dete)?.theme : undefined;
  const theme = storedTheme ? normalizeKidTheme(storedTheme) : DEFAULT_KID_THEME;
  useEffect(() => {
    setPreviewTheme(theme);
    // Hand the attribute back on the way out, so leaving the preview does not
    // leave the login screen wearing a colour nobody picked.
    return () => setPreviewTheme(null);
  }, [theme, setPreviewTheme]);

  // Anything that is not this parent's own family member is a dead end: a typo,
  // a stale link, or someone poking at the URL. Say so and go back.
  //
  // "Have we got an answer yet" is a non-empty roster, NOT `!isLoading`: on a
  // cold load `useFamilyMembers` is merely DISABLED until the profile resolves,
  // and a disabled query reports `isLoading === false`. Reading that as "loaded,
  // and the child is not in it" bounced every direct hit on this URL. A family
  // always contains at least the parent doing the asking, so a non-empty list
  // is the honest signal.
  const rejected = !dete || (members.length > 0 && !member);
  const bounced = useRef(false);
  useEffect(() => {
    if (!rejected || bounced.current) return;
    bounced.current = true;
    toast.error("Taj profil nije član tvoje porodice.");
    // No `clan` on the way out here: the id is exactly what was rejected.
    void navigate({ ...kidPreviewExit(), replace: true });
  }, [rejected, navigate]);

  if (!member) return <KidPreviewSplash />;

  const value: KidPreviewValue = {
    previewProfileId: member.id,
    previewName:
      member.first_name ||
      getDisplayName({
        firstName: member.first_name,
        lastName: member.last_name,
        email: null,
      }) ||
      "dete",
    familyId,
    exitTo,
    exit,
    tab,
    setTab,
  };

  return (
    <KidPreviewProvider value={value}>
      {tab === "/kid" ? (
        <KidTodayView />
      ) : tab === "/kid/uskoro" ? (
        <KidUpcomingView />
      ) : tab === "/kid/raspored" ? (
        <KidScheduleView />
      ) : (
        <KidFamilyView />
      )}
    </KidPreviewProvider>
  );
}

/** The between-frames screen, in the theme the layout is already painting. */
function KidPreviewSplash() {
  return (
    <div
      style={{ backgroundImage: "var(--k-grad)" }}
      className="kid-font grid h-[100dvh] w-full place-items-center text-white"
    >
      <p role="status" className="text-[15px] font-medium opacity-90">
        Samo trenutak...
      </p>
    </div>
  );
}
