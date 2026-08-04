import { format, parseISO } from "date-fns";

import { SectionHeading } from "@/components/common/SectionHeading";
import { srLocale } from "@/utils/date";

/**
 * Day divider for the agenda lists - "5. oktobar · Danas · Ponedeljak" in the
 * shared uppercase group-header style. `today`/`tomorrow` come in as
 * yyyy-MM-dd so the relative token is a string match, without re-deriving "now"
 * per header.
 *
 * `muted` dims the whole header: the calendar's agenda renders a header for
 * EVERY day in the window, and a day with nothing on it should read as an empty
 * slot in a continuous calendar rather than as a real section.
 */
export function AgendaDateHeader({
  day,
  today,
  tomorrow,
  muted = false,
  className,
}: {
  day: string;
  today: string;
  tomorrow: string;
  muted?: boolean;
  className?: string;
}) {
  const date = parseISO(day + "T12:00:00");
  const dayMonth = format(date, "d. MMMM", { locale: srLocale });
  const weekdayRaw = format(date, "EEEE", { locale: srLocale });
  const weekday = `${weekdayRaw.charAt(0).toUpperCase()}${weekdayRaw.slice(1)}`;
  const relative = day === today ? "Danas" : day === tomorrow ? "Sutra" : null;

  return (
    <SectionHeading muted={muted} className={className}>
      {[dayMonth, relative, weekday].filter(Boolean).join(" · ")}
    </SectionHeading>
  );
}
