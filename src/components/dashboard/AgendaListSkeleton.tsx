import { Skeleton } from "@/components/ui/skeleton";

/**
 * Card-shaped loading placeholder for the agenda lists, mirroring
 * `AgendaItemRow`'s frame - glyph tile | title + meta | trailing time - so the
 * screen doesn't jump when the real rows arrive. Widths vary per row to read as
 * text rather than as a table.
 */
const TITLE_WIDTHS = ["w-2/5", "w-1/2", "w-1/3", "w-3/5", "w-2/5"] as const;

export function AgendaListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="space-y-2.5">
      <span className="sr-only">Učitavanje</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3"
        >
          <Skeleton className="size-[42px] shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={`h-3.5 ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]}`} />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}
