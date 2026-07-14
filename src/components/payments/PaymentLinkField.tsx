import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PaymentLinkIcon } from "@/components/payments/PaymentLinkChip";
import { useActivities } from "@/hooks/useActivities";
import { useEventsList } from "@/hooks/useEvents";
import { usePaymentLinkTarget, type PaymentLinkKind } from "@/hooks/usePaymentLinks";
import { useToday } from "@/hooks/useToday";
import { formatDate, subtractMonth } from "@/utils/date";
import { cn } from "@/lib/cn";

/** The payment form's link state — maps to `activity_id` XOR `event_id` on submit. */
export type PaymentLinkValue = {
  kind: PaymentLinkKind;
  id: string;
};

export type PaymentLinkFieldProps = {
  value: PaymentLinkValue | null;
  onChange: (value: PaymentLinkValue | null) => void;
  /**
   * Auto-suggest source — the form's live Naziv value (ADD mode only). When
   * it substring-matches an activity/event name (either direction,
   * case-insensitive) and nothing is linked yet, a one-tap
   * "Poveži sa: <name>?" chip appears under the field. Silent, non-blocking,
   * dismissible per suggestion. Omit to disable (edit mode).
   */
  suggestFromName?: string;
};

type LinkOption = {
  kind: PaymentLinkKind;
  id: string;
  name: string;
  /** Event date — shown next to the name so same-named events stay tellable apart. */
  date?: string;
};

/** How far back the event options reach — recent past + everything upcoming. */
const EVENT_LOOKBACK_MONTHS = 3;

/**
 * Jira-style issue-link combobox for the payment form ("Poveži sa"): one field
 * that is both a dropdown and an autocomplete. Closed it renders as an
 * input-shaped trigger showing the linked entity (type icon + name, with a ×
 * to unlink) or a placeholder; open it's a text input over the merged option
 * list — ALL activities (they're few) plus events from the last
 * {@link EVENT_LOOKBACK_MONTHS} months onward, both filtered client-side and
 * grouped "Aktivnosti" / "Događaji". Arrow keys move, Enter links, Escape
 * closes. Built on the existing Popover + Input primitives — no combobox
 * dependency.
 *
 * A linked event OLDER than the lookback window isn't in the options, so the
 * closed-state label falls back to `usePaymentLinkTarget` (by-id fetch).
 */
export function PaymentLinkField({ value, onChange, suggestFromName }: PaymentLinkFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // `${kind}-${id}` of the dismissed suggestion — per suggestion, so a
  // different match can still surface later while this one stays gone.
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);

  const today = useToday();
  const activitiesQuery = useActivities();
  const eventsQuery = useEventsList({ from: subtractMonth(today.str, EVENT_LOOKBACK_MONTHS) });

  const options = useMemo<LinkOption[]>(() => {
    const activities = (activitiesQuery.data ?? []).map(
      (a): LinkOption => ({ kind: "activity", id: a.id, name: a.name }),
    );
    // Canceled events drop out — linking a payment to something that isn't
    // happening is never the intent (an existing link still displays fine).
    const events = (eventsQuery.data ?? [])
      .filter((e) => !e.canceled_at)
      .map((e): LinkOption => ({ kind: "event", id: e.id, name: e.name, date: e.date }));
    return [...activities, ...events];
  }, [activitiesQuery.data, eventsQuery.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Grouped for display; keyboard navigation walks the same flat `filtered`
  // order (activities first, then events), so index math stays trivial.
  const activityOptions = filtered.filter((o) => o.kind === "activity");
  const eventOptions = filtered.filter((o) => o.kind === "event");

  // Closed-state label: prefer the warm options (covers everything pickable),
  // fall back to the by-id lookup for an old linked event outside the window.
  const selectedPseudoPayment = useMemo(
    () =>
      value
        ? {
            activity_id: value.kind === "activity" ? value.id : null,
            event_id: value.kind === "event" ? value.id : null,
          }
        : null,
    [value],
  );
  const fallbackTarget = usePaymentLinkTarget(selectedPseudoPayment);
  const selected = value
    ? (options.find((o) => o.kind === value.kind && o.id === value.id) ?? fallbackTarget)
    : null;

  // Auto-suggest: first option whose name substring-matches the typed payment
  // name (either direction — "Engleski Lucija jun" ⊃ "Engleski Lucija", and
  // "Engl" ⊂ it). Min 3 chars so single letters don't light it up. Live while
  // typing — effectively the debounce-free version of "on blur", and just as
  // silent since the chip never steals focus.
  const suggestion = useMemo(() => {
    if (value) return null;
    const name = (suggestFromName ?? "").trim().toLowerCase();
    if (name.length < 3) return null;
    return (
      options.find((o) => {
        const optionName = o.name.trim().toLowerCase();
        return optionName.includes(name) || name.includes(optionName);
      }) ?? null
    );
  }, [options, suggestFromName, value]);
  const showSuggestion =
    !!suggestion && dismissedSuggestion !== `${suggestion.kind}-${suggestion.id}`;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setActiveIndex(0);
    }
  };

  const pick = (option: LinkOption) => {
    onChange({ kind: option.kind, id: option.id });
    setOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === "Enter") {
      // Inside the payment <form> — swallow the submit and link instead.
      e.preventDefault();
      const option = filtered[activeIndex];
      if (option) pick(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const renderOption = (option: LinkOption) => {
    const flatIndex = filtered.indexOf(option);
    return (
      <li key={`${option.kind}-${option.id}`}>
        <button
          type="button"
          onClick={() => pick(option)}
          onMouseEnter={() => setActiveIndex(flatIndex)}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
            flatIndex === activeIndex
              ? "bg-gray-100 dark:bg-gray-700"
              : "hover:bg-gray-100 dark:hover:bg-gray-700",
          )}
        >
          <PaymentLinkIcon kind={option.kind} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
            {option.name}
          </span>
          {option.date ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDate(option.date)}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="payment-link">Poveži sa (opciono)</Label>
      <div className="relative">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              id="payment-link"
              type="button"
              className={cn(
                "flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent pr-9 pl-3 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              {selected ? (
                <>
                  <PaymentLinkIcon kind={selected.kind} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left text-gray-900 dark:text-gray-100">
                    {selected.name}
                  </span>
                </>
              ) : (
                <span className="flex-1 truncate text-left text-muted-foreground">
                  Aktivnost ili događaj…
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) p-2" align="start">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Pretraži…"
              aria-label="Pretraži aktivnosti i događaje"
            />
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Nema rezultata.</p>
              ) : (
                <>
                  {activityOptions.length > 0 ? (
                    <div>
                      <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Aktivnosti
                      </p>
                      <ul>{activityOptions.map(renderOption)}</ul>
                    </div>
                  ) : null}
                  {eventOptions.length > 0 ? (
                    <div>
                      <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Događaji
                      </p>
                      <ul>{eventOptions.map(renderOption)}</ul>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {value ? (
          <button
            type="button"
            aria-label="Ukloni vezu"
            onClick={() => onChange(null)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <XMarkIcon className="size-4" />
          </button>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </div>
      {showSuggestion ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => pick(suggestion)}
            className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
          >
            <PaymentLinkIcon kind={suggestion.kind} className="size-3.5 shrink-0" />
            <span className="truncate">Poveži sa: {suggestion.name}?</span>
          </button>
          <button
            type="button"
            aria-label="Odbaci predlog"
            onClick={() => setDismissedSuggestion(`${suggestion.kind}-${suggestion.id}`)}
            className="rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
