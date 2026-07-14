import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Pulse-animated placeholder bar for loading states. Compose several into a
 * row-shaped skeleton that roughly matches the real content (see e.g.
 * `AgendaListSkeleton`) instead of showing a bare "Učitavanje…" line.
 *
 * Purely decorative — give the wrapping container `role="status"` +
 * `aria-busy` with an sr-only "Učitavanje" so screen readers hear one loading
 * announcement, not a pile of empty divs.
 */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-gray-200 dark:bg-gray-700", className)}
      {...props}
    />
  );
}

export { Skeleton };
