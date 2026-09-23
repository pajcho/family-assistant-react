import { SparklesIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";

/**
 * The one-time offer to group a list by supermarket aisle, shown once Jev has
 * judged the list a shopping list and it is not sorted by aisle yet (see
 * `useSmartSort().suggestAisles`).
 *
 * Same voice as LinkSuggestionList: advice, never a prompt. It sits in the
 * flow between the items and the composer, where the eye is when the second
 * item goes in, steals no focus, and either answer puts it away for the whole
 * family: accepting turns aisles on, the × closes it for good.
 */
export function AisleSuggestion({
  onAccept,
  onDismiss,
  pending,
}: {
  onAccept: () => void;
  onDismiss: () => void;
  pending: boolean;
}) {
  return (
    <section aria-label="Predlog" className="mt-3 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <SparklesIcon className="size-3.5 shrink-0 text-accent-deep" aria-hidden="true" />
        <span className="flex-1 text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
          Predlog
        </span>
        <button
          type="button"
          aria-label="Sakrij predlog"
          onClick={onDismiss}
          className="rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <XMarkIcon className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Ovo liči na listu za kupovinu</p>
          <p className="text-xs text-muted-foreground">
            Poređaj stavke po rafovima, redom kako ideš kroz market.
          </p>
        </div>
        <Button size="sm" onClick={onAccept} disabled={pending} className="shrink-0">
          Po rafovima
        </Button>
      </div>
    </section>
  );
}
