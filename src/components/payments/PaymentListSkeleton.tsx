import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

/**
 * Card-shaped loading placeholder for the payments list — matches the real
 * row frame (rounded card, name + due-date lines, amount on the right) so the
 * page doesn't jump when the data arrives.
 */
export function PaymentListSkeleton({
  cards = 4,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-3", className)}>
      <span className="sr-only">Učitavanje</span>
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={cn("h-4", i % 2 === 0 ? "w-2/5" : "w-1/2")} />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
