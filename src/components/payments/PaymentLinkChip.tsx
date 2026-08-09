import { CakeIcon, CalendarIcon, UserGroupIcon } from "@heroicons/react/24/outline";

import type { PaymentLinkKind, PaymentLinkTarget } from "@/hooks/usePaymentLinks";
import { cn } from "@/lib/cn";

/** Type icon for a payment link - activity accent, event info, birthday warn. */
export function PaymentLinkIcon({
  kind,
  className,
}: {
  kind: PaymentLinkKind;
  className?: string;
}) {
  if (kind === "activity") {
    return <UserGroupIcon className={cn("text-accent-deep", className)} aria-hidden="true" />;
  }
  if (kind === "birthday") {
    return <CakeIcon className={cn("text-warn", className)} aria-hidden="true" />;
  }
  return <CalendarIcon className={cn("text-info", className)} aria-hidden="true" />;
}

/**
 * Tappable "Povezano sa" chip - type icon + linked entity name. What the tap
 * opens lives with the caller; in the payment detail sheet it's the linked
 * entity's own DETAIL popup (see `LinkedEntityViewer`), not its edit form.
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
        "inline-flex min-w-0 max-w-full items-center gap-1.5 py-1 text-sm font-medium text-accent-deep underline-offset-4 hover:underline",
        className,
      )}
    >
      <PaymentLinkIcon kind={target.kind} className="size-4 shrink-0" />
      <span className="truncate">{target.name}</span>
    </button>
  );
}
