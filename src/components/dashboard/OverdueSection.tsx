import { format, parseISO } from "date-fns";

import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { type AgendaItem, agendaItemKey } from "@/hooks/useAgenda";
import { srLocale } from "@/utils/date";

/**
 * The "Prekoračeno" (overdue) section shared by the Danas and Uskoro tabs — the
 * past-due unpaid payments from `useOverduePayments`, pinned above today. The
 * red header signals lateness; each row shows its due date in the gutter (the
 * payment row is otherwise time-less) so you can tell how overdue it is.
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
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-red-600 uppercase dark:text-red-400">
        Prekoračeno
      </h3>
      <ul className="space-y-1">
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
