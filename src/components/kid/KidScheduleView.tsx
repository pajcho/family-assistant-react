import { useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";

import { KidScreen } from "@/components/kid/KidScreen";
import { KidDayPills, KidSchoolFooter, KidSchoolLadder } from "@/components/kid/KidSchool";
import { KidCardSkeleton, KidEmptyState } from "@/components/kid/KidUi";
import {
  currentPeriodIndex,
  useKidSchoolWeek,
  useNowMinutes,
} from "@/components/kid/useKidSchoolWeek";
import { useKidSession } from "@/hooks/useKidSession";
import { useToday } from "@/hooks/useToday";
import { DAY_LABELS_SHORT, getWeekStart } from "@/utils/activity";

/**
 * Raspored - this week's classes, one school day at a time.
 *
 * The grown-up app draws a clock grid across the whole week; a child counts
 * classes, so this is a numbered ladder for a single day with the veliki odmor
 * drawn in as a divider. The day pills live inside the gradient header, which
 * keeps the body a single uninterrupted scroll.
 *
 * Read-only, like everything else here: the closing line says out loud that the
 * timetable belongs to the grown-ups, so an empty day never reads as the
 * child's fault.
 *
 * A component rather than a route body so `/kid/raspored` and the preview
 * render the SAME screen. `useKidSchoolWeek` already filters to one person in
 * code, so it tells a previewing parent the truth unchanged.
 */
export function KidScheduleView() {
  const today = useToday();
  const { kidProfileId } = useKidSession();
  const weekStart = useMemo(() => getWeekStart(today.str), [today.str]);

  // Mon-Fri only: Saturday and Sunday have no timetable, and offering them
  // would just be two pills that are always empty.
  const days = useMemo(() => {
    const monday = parseISO(weekStart + "T12:00:00");
    return Array.from({ length: 5 }, (_, i) => ({
      date: format(addDays(monday, i), "yyyy-MM-dd"),
      label: DAY_LABELS_SHORT[i],
    }));
  }, [weekStart]);

  // Start on today when today is a school day, otherwise on Monday. Held as a
  // nullable override so an overnight suspend (new week, stale date) falls back
  // to the new week's default instead of pointing at a day that is gone.
  const [picked, setPicked] = useState<string | null>(null);
  const fallbackDate = days.some((d) => d.date === today.str) ? today.str : days[0].date;
  const selected = picked && days.some((d) => d.date === picked) ? picked : fallbackDate;

  const school = useKidSchoolWeek(weekStart, kidProfileId);
  const nowMinutes = useNowMinutes();

  const blocks = school.blocksByDate.get(selected) ?? [];
  const breakLabel = school.breakDays.get(selected) ?? null;
  const nowPeriod = currentPeriodIndex(blocks, nowMinutes, selected === today.str);

  /**
   * The raspust label when EVERY school day this week is off, else null.
   *
   * A whole-week break changes the screen rather than just one day of it: the
   * shift ("ove nedelje si po podne") is about when classes are, and there are
   * none - so it is noise at best and confusing at worst. The day pills go too,
   * since five pills leading to five identical "Raspust!" screens is five taps
   * to the same answer.
   */
  const weekBreakLabel = useMemo(() => {
    const labels = days.map((day) => school.breakDays.get(day.date));
    if (labels.some((label) => !label)) return null;
    const unique = [...new Set(labels as string[])];
    return unique.join(" · ");
  }, [days, school.breakDays]);

  const subtitle = school.isLoading
    ? "učitavam tvoj raspored"
    : weekBreakLabel
      ? `${weekBreakLabel.toLowerCase()} - nema škole 🌴`
      : school.shift === "morning"
        ? "ove nedelje si pre podne ☀️"
        : school.shift === "afternoon"
          ? "ove nedelje si po podne 🌙"
          : "tvoji časovi ove nedelje";

  return (
    <KidScreen
      title="Raspored 🎒"
      subtitle={subtitle}
      headerExtra={
        weekBreakLabel ? undefined : (
          <KidDayPills days={days} selected={selected} todayISO={today.str} onSelect={setPicked} />
        )
      }
    >
      {school.isLoading ? (
        <>
          <p role="status" className="sr-only">
            Učitavam raspored
          </p>
          <KidCardSkeleton count={5} />
        </>
      ) : weekBreakLabel ? (
        <KidEmptyState
          emoji="🌴"
          title="Raspust!"
          hint="Cela ova nedelja je slobodna - nema časova nijedan dan."
        />
      ) : breakLabel ? (
        <KidEmptyState
          emoji="🌴"
          title="Raspust!"
          hint={`${breakLabel} - ${selected === today.str ? "danas" : "tog dana"} nema škole.`}
        />
      ) : blocks.length === 0 ? (
        <KidEmptyState
          emoji={school.hasTimetable ? "🎈" : "📘"}
          title={school.hasTimetable ? "Tog dana nemaš časove" : "Raspored još nije unet"}
          hint={
            school.hasTimetable
              ? "Probaj drugi dan gore."
              : "Roditelji ga unose u glavnoj aplikaciji."
          }
        />
      ) : (
        <>
          <KidSchoolLadder
            blocks={blocks}
            bigBreakAfterPeriod={school.bigBreakAfterPeriod}
            bigBreakRange={school.bigBreakRange}
            nowPeriod={nowPeriod}
          />
          <KidSchoolFooter />
        </>
      )}
    </KidScreen>
  );
}
