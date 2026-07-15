import { CakeIcon, CalendarIcon, UserGroupIcon } from "@heroicons/react/24/outline";

import type { PaymentLinkKind, PaymentLinkTarget } from "@/hooks/usePaymentLinks";
import { cn } from "@/lib/cn";

/** Type icon for a payment link — activity violet, event blue, birthday pink. */
export function PaymentLinkIcon({
  kind,
  className,
}: {
  kind: PaymentLinkKind;
  className?: string;
}) {
  if (kind === "activity") {
    return (
      <UserGroupIcon
        className={cn("text-violet-500 dark:text-violet-400", className)}
        aria-hidden="true"
      />
    );
  }
  if (kind === "birthday") {
    return (
      <CakeIcon className={cn("text-pink-500 dark:text-pink-400", className)} aria-hidden="true" />
    );
  }
  return (
    <CalendarIcon
      className={cn("text-blue-500 dark:text-blue-400", className)}
      aria-hidden="true"
    />
  );
}

/**
 * Tappable "Povezano sa" chip — type icon + linked entity name. Shared by the
 * payment detail dialog and the Plaćanja list rows; navigation lives with the
 * caller (activity → /activities?edit=<id>, event → /events).
 */
export function PaymentLinkChip({
  target,
  onClick,
  className,
}: {
  target: PaymentLinkTarget;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400",
        className,
      )}
    >
      <PaymentLinkIcon kind={target.kind} className="size-4 shrink-0" />
      <span className="truncate">{target.name}</span>
    </button>
  );
}
