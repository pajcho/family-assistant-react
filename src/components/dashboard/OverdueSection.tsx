import { format, parseISO } from "date-fns";

import { Amount } from "@/components/common/Amount";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { type AgendaItem, agendaItemKey } from "@/hooks/useAgenda";
import { srLocale } from "@/utils/date";

/**
 * Everything that is already late, in one block pinned above today - the
 * past-due unpaid payments AND the unfinished tasks, merged and sorted oldest
 * first by `useOverdueItems`. A repeating chore appears here as ONE row per
 * task however many of its instances are behind, dated to the oldest and
 * carrying a "3 propuštena" pill; `useOverdueTasks` is where that collapse happens.
 *
 * One block rather than two on purpose: "what have I let slip" is a single
 * question, and splitting it by whether the thing costs money buries the shorter
 * half. The red header signals lateness and carries the summed amount, which
 * only the payments contribute to; each row repeats its own deadline in the meta
 * line (neither kind carries a date otherwise) so you can tell how late it is.
 *
 * A dumb renderer by design: it takes ONE list, because the two definitions of
 * late differ and each rule belongs in its own hook, not in here.
 */
function overdueDateLabel(date: string): string {
  return format(parseISO(date + "T12:00:00"), "d. MMM", { locale: srLocale });
}

export function OverdueSection({
  items,
  onSelect,
}: {
  items: AgendaItem[];
  onSelect: (item: AgendaItem) => void;
}) {
  if (items.length === 0) return null;
  // Only payment amounts count towards the header total: a late task has no
  // price, and a sum that silently skipped half the rows would read as one.
  const totalAmount = items.reduce(
    (sum, item) => (item.kind === "payment" ? sum + item.payment.amount : sum),
    0,
  );
  return (
    // This block must TOUCH the day sections below it, or the handoff between
    // "Prekoračeno" and the first day's header runs through a strip belonging to
    // no section. `mb-0` is what drops the agenda list's `space-y-5` here
    // (Tailwind puts it on the child, at zero specificity); the gap itself is
    // the row list's `pb-5`, inside the section - see `SectionHeading`.
    <section className="mb-0">
      {/* Pinned like the day headers below it, by the same shared recipe - what
          is late stays named while you scroll through it. */}
      <SectionHeading as="h3" tone="neg" count={items.length} sticky>
        Prekoračeno
        {totalAmount > 0 ? (
          <>
            {" · "}
            <Amount value={totalAmount} round />
          </>
        ) : null}
      </SectionHeading>
      <ul className="space-y-2.5 pb-5">
        {items.map((item) => (
          <AgendaItemRow
            key={agendaItemKey(item)}
            item={item}
            onClick={() => onSelect(item)}
            dateLabel={overdueDateLabel(item.date)}
          />
        ))}
      </ul>
    </section>
  );
}
