import { CheckIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { MemberBadges } from "@/components/common/MemberBadges";
import { PaymentLinkIcon } from "@/components/payments/PaymentLinkChip";
import type { LinkOption } from "@/hooks/useLinkOptions";
import { suggestionDetail, type LinkSuggestion } from "@/utils/linkSuggestions";
import { cn } from "@/lib/cn";

/**
 * The ranked "Poveži sa" suggestions, as tappable rows under the link field
 * (and at the top of the picker sheet).
 *
 * Every row prints its evidence on a second line - "u toku · 05.08. -
 * 15.08.2026", "u to vreme · 17:00 - 18:00", "za 2 dana · 11.08.2026". That
 * line is the point of the whole thing: the previous version offered a single
 * bare name with no date, which is how a payment made in August ended up
 * linked to an event from May.
 *
 * Advice, never a prompt: nothing is preselected, nothing steals focus, and
 * one × puts the block away for the rest of the form.
 */
export type LinkSuggestionListProps = {
  suggestions: ReadonlyArray<LinkSuggestion<LinkOption>>;
  onPick: (option: LinkOption) => void;
  /** Omitted inside the picker sheet, where the list is part of the content. */
  onDismiss?: () => void;
  /** The currently linked target - check-marked instead of offered again. */
  selectedId?: string | null;
  className?: string;
};

export function LinkSuggestionList({
  suggestions,
  onPick,
  onDismiss,
  selectedId,
  className,
}: LinkSuggestionListProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <SparklesIcon className="size-3.5 shrink-0 text-accent-deep" aria-hidden="true" />
        <span className="flex-1 text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
          {suggestions.length === 1 ? "Predlog" : "Predlozi"}
        </span>
        {onDismiss ? (
          <button
            type="button"
            aria-label="Sakrij predloge"
            onClick={onDismiss}
            className="rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {suggestions.map((suggestion) => {
          const option = suggestion.candidate;
          const isSelected = selectedId === option.id;
          return (
            <li key={`${option.kind}-${option.id}`}>
              <button
                type="button"
                onClick={() => onPick(option)}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isSelected
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <PaymentLinkIcon kind={option.kind} className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {option.name}
                  </span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {suggestionDetail(suggestion)}
                  </span>
                </span>
                {option.personIds.length > 0 ? (
                  <MemberBadges
                    personIds={option.personIds}
                    size="xs"
                    max={3}
                    className="shrink-0"
                  />
                ) : null}
                {isSelected ? (
                  <CheckIcon className="size-4 shrink-0 text-accent-deep" aria-hidden="true" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
