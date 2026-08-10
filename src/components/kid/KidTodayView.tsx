import { useMemo } from "react";

import { KidAgendaList } from "@/components/kid/KidAgendaCard";
import { KidScreen } from "@/components/kid/KidScreen";
import { KidSchoolTodayCard } from "@/components/kid/KidSchool";
import {
  KidCard,
  KidCardMain,
  KidCardMeta,
  KidCardSkeleton,
  KidCardTitle,
  KidDone,
  KidEmptyState,
  KidTile,
} from "@/components/kid/KidUi";
import { filterKidAgendaItems } from "@/components/kid/kidAgendaModel";
import { formatKidLongDate } from "@/components/kid/kidCopy";
import { useKidBirthdayVisibility } from "@/components/kid/useKidBirthdayVisibility";
import {
  currentPeriodIndex,
  useKidSchoolWeek,
  useNowMinutes,
} from "@/components/kid/useKidSchoolWeek";
import { isCanceledAgendaItem, useAgenda } from "@/hooks/useAgenda";
import { useKidSession } from "@/hooks/useKidSession";
import { useKidTabNavigate } from "@/hooks/useKidPreview";
import { useToday } from "@/hooks/useToday";
import { getWeekStart } from "@/utils/activity";

/**
 * Danas - the screen a child opens the app on.
 *
 * Order is deliberate: school first (it is the fixed point of the day), then
 * everything else in time order, then a full stop that says the day is done.
 * Nothing here is editable and there is no "+" - a tap only ever opens details.
 *
 * A component rather than a route body so `/kid` and `/kid/preview` render the
 * SAME screen. Everything it shows is filtered to `kidProfileId` in code, which
 * is what makes it safe to render under a parent's much wider session.
 */
export function KidTodayView() {
  const today = useToday();
  const goToTab = useKidTabNavigate();
  const { kidProfileId } = useKidSession();

  // `useAgenda` is mounted on exactly one kid screen at a time - Danas and
  // Uskoro are separate routes (and, in the preview, mutually exclusive tabs).
  //
  // `includeCanceled` is the kid shell's one departure from the grown-up
  // agenda: a parent who cancels something knows they cancelled it, a child
  // only knows the thing they were counting on is gone.
  const { items, isLoading } = useAgenda({
    from: today.str,
    to: today.str,
    includeCanceled: true,
  });
  const birthdays = useKidBirthdayVisibility(kidProfileId);

  const personIds = useMemo(() => new Set(kidProfileId ? [kidProfileId] : []), [kidProfileId]);
  const mine = useMemo(
    () => filterKidAgendaItems(items, personIds, birthdays.visibleIds),
    [items, personIds, birthdays.visibleIds],
  );

  const weekStart = useMemo(() => getWeekStart(today.str), [today.str]);
  const school = useKidSchoolWeek(weekStart, kidProfileId);
  const nowMinutes = useNowMinutes();

  const todayBlocks = school.blocksByDate.get(today.str) ?? [];
  const nowPeriod = currentPeriodIndex(todayBlocks, nowMinutes, true);
  const breakLabel = school.breakDays.get(today.str) ?? null;

  // The visibility query joins the loading gate: without it a birthday the
  // child may see would pop in a beat after the rest of the day had settled.
  const loading = isLoading || school.isLoading || birthdays.isLoading;
  // A day whose only row is a cancellation is NOT an empty day - there is
  // something to tell the child - and `mine` being non-empty keeps the empty
  // state away on its own.
  const nothingAtAll = !loading && mine.length === 0 && todayBlocks.length === 0;
  // ...but the closing line must not count a cancelled row as a plan: "to je
  // an all-done line after one struck-through card would imply there was a day.
  const anythingOn = todayBlocks.length > 0 || mine.some((item) => !isCanceledAgendaItem(item));

  return (
    <KidScreen title="Ćao! 👋" subtitle={formatKidLongDate(today.str)}>
      {loading ? (
        <>
          <p role="status" className="sr-only">
            Učitavam tvoj dan
          </p>
          <KidCardSkeleton count={3} />
        </>
      ) : nothingAtAll ? (
        <KidEmptyState
          emoji="🌤️"
          title="Danas nemaš ništa u planu"
          hint={
            breakLabel
              ? `${breakLabel} - uživaj!`
              : "Slobodan dan. Kad se nešto pojavi, videćeš ga ovde."
          }
        />
      ) : (
        <>
          {breakLabel && todayBlocks.length === 0 ? (
            <KidCard>
              <KidTile emoji="🌴" />
              <KidCardMain>
                <KidCardTitle>Danas nema škole</KidCardTitle>
                <KidCardMeta>{breakLabel}</KidCardMeta>
              </KidCardMain>
            </KidCard>
          ) : null}

          <KidSchoolTodayCard
            blocks={todayBlocks}
            nowPeriod={nowPeriod}
            onOpen={() => goToTab("/kid/schedule")}
          />

          <KidAgendaList items={mine} todayISO={today.str} birthdayNotes={birthdays.notes} />

          <KidDone>{anythingOn ? "To je sve za danas! 🎈" : "Danas nemaš ništa drugo. 🌤️"}</KidDone>
        </>
      )}
    </KidScreen>
  );
}
