import { KidScreen } from "@/components/kid/KidScreen";
import { KidBirthdayList, KidFamilyGrid, useKidBirthdayEntries } from "@/components/kid/KidFamily";
import { KidCardSkeleton, KidEmptyState, KidGroupHeading } from "@/components/kid/KidUi";
import { useKidBirthdayVisibility } from "@/components/kid/useKidBirthdayVisibility";
import { useBirthdaysList } from "@/hooks/useBirthdays";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useKidSession } from "@/hooks/useKidSession";
import { useProfile } from "@/hooks/useProfile";
import { useToday } from "@/hooks/useToday";

/**
 * Porodica - the family, and the birthdays this child was told about.
 *
 * Reads birthdays straight from `useBirthdaysList` rather than through the
 * agenda: the agenda would drag in payments, events and the Google mirror to
 * answer a question that is one small table, and only Danas / Uskoro should be
 * paying for that. That list is whatever the SESSION may read, so
 * `useKidBirthdayEntries` narrows it to the ticked rows in code - which is what
 * keeps the count identical for a child and for a parent previewing them.
 *
 * A component rather than a route body so `/kid/porodica` and the preview
 * render the SAME screen.
 */
export function KidFamilyView() {
  const today = useToday();
  const { kidProfileId } = useKidSession();
  const { familyName } = useProfile();
  const { members, isLoading: membersLoading } = useFamilyMembers();
  const birthdaysQuery = useBirthdaysList();
  const visibility = useKidBirthdayVisibility(kidProfileId);

  const entries = useKidBirthdayEntries(birthdaysQuery.data ?? [], visibility, today.str);
  const loading = membersLoading || birthdaysQuery.isLoading || visibility.isLoading;

  return (
    <KidScreen title="Porodica ❤️" subtitle={familyName ?? "tvoja porodica"}>
      {loading ? (
        <>
          <p role="status" className="sr-only">
            Učitavam porodicu
          </p>
          <KidCardSkeleton count={3} />
        </>
      ) : members.length === 0 ? (
        <KidEmptyState
          emoji="👋"
          title="Ovde će biti tvoja porodica"
          hint="Članove dodaju roditelji u glavnoj aplikaciji."
        />
      ) : (
        <>
          <KidFamilyGrid members={members} meProfileId={kidProfileId} />

          <KidGroupHeading title="Sledeći rođendani" />
          {entries.length > 0 ? (
            <KidBirthdayList entries={entries} />
          ) : (
            <KidEmptyState
              emoji="🎂"
              title="Nema rođendana za tebe"
              hint="Roditelji biraju koje rođendane vidiš."
            />
          )}
        </>
      )}
    </KidScreen>
  );
}
