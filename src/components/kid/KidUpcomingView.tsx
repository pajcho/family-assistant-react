import { useMemo } from "react";
import { addDays, format } from "date-fns";

import { KidAgendaList } from "@/components/kid/KidAgendaCard";
import { KidScreen } from "@/components/kid/KidScreen";
import { KidCardSkeleton, KidDone, KidEmptyState } from "@/components/kid/KidUi";
import { filterKidAgendaItems } from "@/components/kid/kidAgendaModel";
import { useKidBirthdayVisibility } from "@/components/kid/useKidBirthdayVisibility";
import { isCanceledAgendaItem, useAgenda } from "@/hooks/useAgenda";
import { useKidSession } from "@/hooks/useKidSession";
import { useToday } from "@/hooks/useToday";

/** Days ahead of today the screen looks. Tomorrow + 13 = two full weeks. */
const HORIZON_DAYS = 14;

/**
 * Uskoro - the next two weeks, grouped by day.
 *
 * Deliberately a fixed, short horizon rather than the grown-up app's growing
 * one: the next two weeks is a span a child can hold in their head, and a
 * list that never ends is a list nobody reaches the bottom of. Day headings
 * carry a countdown chip once a bare date stops meaning anything.
 *
 * A component rather than a route body so `/kid/upcoming` and the preview render
 * the SAME screen.
 */
export function KidUpcomingView() {
  const today = useToday();
  const { kidProfileId } = useKidSession();

  const { from, to } = useMemo(
    () => ({
      from: format(addDays(today.date, 1), "yyyy-MM-dd"),
      to: format(addDays(today.date, HORIZON_DAYS), "yyyy-MM-dd"),
    }),
    [today.date],
  );

  // Cancelled things stay in the list (struck through, on the day they would
  // have happened) - see the note in `KidTodayView`.
  const { items, isLoading } = useAgenda({ from, to, includeCanceled: true });
  const birthdays = useKidBirthdayVisibility(kidProfileId);

  const personIds = useMemo(() => new Set(kidProfileId ? [kidProfileId] : []), [kidProfileId]);
  const mine = useMemo(
    () => filterKidAgendaItems(items, personIds, birthdays.visibleIds),
    [items, personIds, birthdays.visibleIds],
  );

  // The visibility query joins the loading gate, so a visible birthday never
  // pops in after the list has already settled.
  const loading = isLoading || birthdays.isLoading;
  // Two weeks whose only rows are cancellations are not two full weeks, so the
  // closing line says so rather than implying there was something.
  const anythingOn = mine.some((item) => !isCanceledAgendaItem(item));

  return (
    <KidScreen title="Uskoro 🔭" subtitle="sledeće dve nedelje">
      {loading ? (
        <>
          <p role="status" className="sr-only">
            Učitavam šta te čeka
          </p>
          <KidCardSkeleton count={4} />
        </>
      ) : mine.length === 0 ? (
        <KidEmptyState
          emoji="🌈"
          title="Sledeće dve nedelje su slobodne"
          hint="Kad roditelji nešto dodaju, odmah će se pojaviti ovde."
        />
      ) : (
        <>
          <KidAgendaList
            items={mine}
            todayISO={today.str}
            grouped
            birthdayNotes={birthdays.notes}
          />
          <KidDone>{anythingOn ? "To je sve za sada! 🔭" : "Ništa drugo te ne čeka. 🔭"}</KidDone>
        </>
      )}
    </KidScreen>
  );
}
