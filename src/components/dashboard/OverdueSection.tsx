import { format, parseISO } from "date-fns";

import { Amount } from "@/components/common/Amount";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { type AgendaItem, agendaItemKey } from "@/hooks/useAgenda";
import { srLocale } from "@/utils/date";

/**
 * The overdue section shared by Today and the calendar's
 * agenda - the past-due unpaid payments from `useOverduePayments`, pinned above
 * today. The red header signals lateness and carries the summed amount so the
 * total damage is glanceable; each row repeats its due date in the meta line
 * (the payment row is otherwise date-less) so you can tell how overdue it is.
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
  // Only payment amounts count towards the header total - today the section
  // is payments-only, but the guard keeps a future mixed feed honest.
  const totalAmount = items.reduce(
    (sum, item) => (item.kind === "payment" ? sum + item.payment.amount : sum),
    0,
  );
  return (
    <section>
      <SectionHeading as="h3" tone="neg" count={items.length} className="mb-2">
        Prekoračeno
        {totalAmount > 0 ? (
          <>
            {" · "}
            <Amount value={totalAmount} round />
          </>
        ) : null}
      </SectionHeading>
      <ul className="space-y-2.5">
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
