import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { addDays, format, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { Amount } from "@/components/common/Amount";
import { cn } from "@/lib/cn";
import type { AgendaItem } from "@/hooks/useAgenda";
import { agendaItemKey } from "@/hooks/useAgenda";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile, getWeekStart } from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { placanjaLabel } from "@/utils/plural";

/**
 * The desktop-only right column on Danas (>= lg).
 *
 * It answers the questions that used to cost a screen change: what is overdue,
 * where am I in the month, and what is coming in the next few days. On a phone
 * these stay where they are (overdue is a banner above the timeline, the rest
 * lives in Kalendar) - a phone has no spare column, and stacking them under the
 * timeline would just bury the day.
 */

export function TodayRail({
  today,
  overdueItems,
  upcoming,
  countByDay,
}: {
  today: string;
  overdueItems: ReadonlyArray<AgendaItem>;
  /** Agenda items after today, ascending - the source for "Sledeći dani". */
  upcoming: ReadonlyArray<AgendaItem>;
  countByDay: Map<string, number>;
}) {
  const overdueTotal = overdueItems.reduce(
    (sum, item) => (item.kind === "payment" ? sum + item.payment.amount : sum),
    0,
  );

  return (
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:flex-col lg:gap-3 lg:self-start">
      {overdueItems.length > 0 ? (
        <Link
          to="/novac"
          search={{ tab: "placanja" }}
          className="flex items-center gap-2.5 rounded-xl bg-neg-soft px-3.5 py-3 text-[13.5px] font-semibold text-neg transition-transform active:scale-[0.99]"
        >
          <ExclamationTriangleIcon className="size-[17px] flex-none" />
          <span>
            Prekoračeno · {overdueItems.length} {placanjaLabel(overdueItems.length)}
          </span>
          <span className="ml-auto font-bold tabular-nums">
            <Amount value={overdueTotal} round />
          </span>
        </Link>
      ) : null}

      <MiniMonth today={today} countByDay={countByDay} />
      <NextDays today={today} items={upcoming} />
    </aside>
  );
}

/** Month grid with a load dot per busy day; a day opens Kalendar on that day. */
function MiniMonth({ today, countByDay }: { today: string; countByDay: Map<string, number> }) {
  const navigate = useNavigate();
  const todayDate = parseISO(`${today}T12:00:00`);
  const monthName = format(todayDate, "LLLL", { locale: srLocale });

  const cells = useMemo(() => {
    const first = startOfMonth(todayDate);
    // Monday-first grid: start on the Monday of the week the 1st falls in.
    const gridStart = parseISO(`${getWeekStart(format(first, "yyyy-MM-dd"))}T12:00:00`);
    const total =
      Math.ceil((first.getDay() === 0 ? 6 : first.getDay() - 1 + getDaysInMonth(todayDate)) / 7) *
      7;
    return Array.from({ length: total }, (_, i) => {
      const date = addDays(gridStart, i);
      const day = format(date, "yyyy-MM-dd");
      return {
        day,
        label: Number(day.slice(8, 10)),
        outside: day.slice(0, 7) !== today.slice(0, 7),
        busy: (countByDay.get(day) ?? 0) > 0,
      };
    });
  }, [todayDate, today, countByDay]);

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[19px] font-semibold tracking-tight">
          {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
        </span>
        <Link
          to="/kalendar"
          search={{ view: "mesec" }}
          className="ml-auto text-[11.5px] font-semibold text-accent-deep hover:underline"
        >
          Otvori kalendar
        </Link>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-0.5">
        {["po", "ut", "sr", "če", "pe", "su", "ne"].map((wd) => (
          <div
            key={wd}
            className="pb-0.5 text-center text-[9.5px] font-bold text-muted-foreground uppercase"
          >
            {wd}
          </div>
        ))}
        {cells.map((cell) => {
          const isToday = cell.day === today;
          return (
            <button
              key={cell.day}
              type="button"
              aria-label={cell.day}
              aria-current={isToday ? "date" : undefined}
              onClick={() => {
                // `resetScroll: false`: the agenda scrolls itself to the day,
                // and the router's own scroll pass would cancel that jump
                // (see the note in routes/_app.kalendar.tsx).
                void navigate({
                  to: "/kalendar",
                  search: { view: "agenda", day: cell.day },
                  resetScroll: false,
                });
              }}
              className={cn(
                "flex aspect-[1.1] flex-col items-center justify-center gap-0.5 rounded-sm border border-transparent text-xs font-semibold tabular-nums transition-colors",
                cell.outside && "opacity-30",
                isToday ? "border-accent text-accent-deep" : "hover:bg-muted",
              )}
            >
              {cell.label}
              <span
                className={cn(
                  "size-1 rounded-full",
                  cell.busy
                    ? isToday
                      ? "bg-accent"
                      : "bg-muted-foreground opacity-50"
                    : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The next few days at a glance - day, what it is, whose it is. */
function NextDays({ today, items }: { today: string; items: ReadonlyArray<AgendaItem> }) {
  const { byId } = useFamilyMembers();
  const rows = items.filter((item) => item.date > today).slice(0, 6);

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
      <div className="flex items-center gap-2">
        <h4 className="text-[11.5px] font-bold tracking-wider text-muted-foreground uppercase">
          Sledeći dani
        </h4>
        <Link
          to="/kalendar"
          search={{ view: "agenda" }}
          className="ml-auto text-[11.5px] font-semibold text-accent-deep hover:underline"
        >
          Sve
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-[12.5px] font-normal text-muted-foreground">
          Do kraja meseca nema ničega.
        </p>
      ) : (
        <div className="mt-1">
          {rows.map((item) => (
            <Link
              key={agendaItemKey(item)}
              to="/kalendar"
              search={{ view: "agenda", day: item.date }}
              resetScroll={false}
              className="flex items-center gap-2 border-b border-border py-2 text-[13px] last:border-b-0 hover:bg-muted"
            >
              <span className="w-12 flex-none text-[11.5px] font-bold text-muted-foreground uppercase tabular-nums">
                {format(parseISO(`${item.date}T12:00:00`), "EEEEEE d.", { locale: srLocale })}
              </span>
              <span className="min-w-0 flex-1 truncate font-normal">{itemLabel(item)}</span>
              {item.kind === "payment" ? (
                <span className="flex-none text-[12.5px] font-bold tabular-nums">
                  <Amount value={item.payment.amount} round />
                </span>
              ) : (
                itemPersonIds(item).map((id) => (
                  <span
                    key={id}
                    className="size-[7px] flex-none rounded-full"
                    style={{
                      backgroundColor: byId.get(id)?.color ?? fallbackColorForProfile(id),
                    }}
                    aria-hidden="true"
                  />
                ))
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function itemLabel(item: AgendaItem): string {
  switch (item.kind) {
    case "activity":
      return item.activity?.name ?? "Aktivnost";
    case "event":
      return item.event.name;
    case "external":
      return item.event.title ?? "(bez naslova)";
    case "payment":
      return item.payment.name;
    case "birthday":
      return item.birthday.name;
  }
}

function itemPersonIds(item: AgendaItem): string[] {
  switch (item.kind) {
    case "activity":
      return [item.block.personId];
    case "event":
    case "external":
      return item.personIds;
    default:
      return [];
  }
}
