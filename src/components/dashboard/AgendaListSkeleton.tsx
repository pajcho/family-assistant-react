import { Skeleton } from "@/components/ui/skeleton";

/**
 * Row-shaped loading placeholder for the agenda lists (Danas + Uskoro),
 * mirroring `AgendaItemRow`'s frame — time gutter | type indicator | label —
 * so the page doesn't jump when the real rows arrive. Widths vary per row to
 * read as text, not as a table.
 */
const LABEL_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3"] as const;

export function AgendaListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="mt-2 space-y-1">
      <span className="sr-only">Učitavanje</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="w-24 shrink-0">
            <Skeleton className="h-3 w-16" />
          </span>
          <Skeleton className="size-2.5 shrink-0 rounded-full" />
          <Skeleton className={`h-3 ${LABEL_WIDTHS[i % LABEL_WIDTHS.length]}`} />
        </div>
      ))}
    </div>
  );
}
