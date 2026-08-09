import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MemberBadges } from "@/components/common/MemberBadges";
import { LinkSuggestionList } from "@/components/payments/LinkSuggestionList";
import { PaymentLinkIcon } from "@/components/payments/PaymentLinkChip";
import {
  ALL_LINK_KINDS,
  usePaymentLinkOptions,
  useLinkSuggestions,
  type LinkOption,
} from "@/hooks/useLinkOptions";
import { usePaymentLinkTarget, type PaymentLinkKind } from "@/hooks/usePaymentLinks";
import { candidateDetail, type SuggestionContext } from "@/utils/linkSuggestions";
import { cn } from "@/lib/cn";

/** The payment form's link state - maps to `activity_id` XOR `event_id` on submit. */
export type PaymentLinkValue = {
  kind: PaymentLinkKind;
  id: string;
};

/**
 * Stable string form of a link ("activity:<uuid>") - form dialogs key their
 * reseed effects on this instead of the object, so an inline-constructed
 * `initialLink` prop can't retrigger the reseed every render and wipe what
 * the user already typed.
 */
export function paymentLinkSeed(link: PaymentLinkValue | null | undefined): string {
  return link ? `${link.kind}:${link.id}` : "";
}

/** Inverse of `paymentLinkSeed`; empty string maps back to null. */
export function parsePaymentLinkSeed(seed: string): PaymentLinkValue | null {
  if (!seed) return null;
  const idx = seed.indexOf(":");
  if (idx <= 0) return null;
  return { kind: seed.slice(0, idx) as PaymentLinkKind, id: seed.slice(idx + 1) };
}

export type PaymentLinkFieldProps = {
  value: PaymentLinkValue | null;
  onChange: (value: PaymentLinkValue | null) => void;
  /**
   * What the entry knows about itself - the live Naziv, its date, and (only
   * for a scanned fiscal receipt) the time on it. Feeds the ranked suggestion
   * list under the field; see `utils/linkSuggestions`. ADD mode only - omit in
   * edit mode, where an entry matching its own link is noise.
   */
  suggest?: SuggestionContext | null;
  /**
   * Which link kinds are offered. Defaults to all three; the EXPENSE forms
   * pass ["activity", "event"] since `expenses` has no birthday link.
   */
  kinds?: ReadonlyArray<PaymentLinkKind>;
  /**
   * Mobile sheet contexts: when set, the trigger opens the hosting dialog's
   * full-sheet picker sub-view (see PaymentLinkPickerSheet) instead of the
   * inline popover - a popover + software keyboard pushes the whole app
   * off-screen there. Desktop forms omit it and keep the combobox.
   */
  onOpenPicker?: () => void;
};

/**
 * Jira-style issue-link combobox for the payment form ("Poveži sa"): one field
 * that is both a dropdown and an autocomplete. Closed it renders as an
 * input-shaped trigger showing the linked entity (type icon + name, with a ×
 * to unlink) or a placeholder; open it's a text input over the merged option
 * list - ALL activities (they're few) plus events from the last
 * {@link EVENT_LOOKBACK_MONTHS} months onward, both filtered client-side and
 * grouped "Aktivnosti" / "Događaji". Arrow keys move, Enter links, Escape
 * closes. Built on the existing Popover + Input primitives - no combobox
 * dependency.
 *
 * A linked event OLDER than the lookback window isn't in the options, so the
 * closed-state label falls back to `usePaymentLinkTarget` (by-id fetch).
 */
export function PaymentLinkField({
  value,
  onChange,
  suggest,
  kinds,
  onOpenPicker,
}: PaymentLinkFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Suggestions are advice, not a prompt - one × puts them away for the rest
  // of this form. They come back when the form is reopened, not before.
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);

  const options = usePaymentLinkOptions(kinds);
  const suggestions = useLinkSuggestions(value ? null : suggest, kinds);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Grouped for display; keyboard navigation walks the same flat `filtered`
  // order (activities, then events, then birthdays), so index math stays trivial.
  const activityOptions = filtered.filter((o) => o.kind === "activity");
  const eventOptions = filtered.filter((o) => o.kind === "event");
  const birthdayOptions = filtered.filter((o) => o.kind === "birthday");

  // Closed-state label: prefer the warm options (covers everything pickable),
  // fall back to the by-id lookup for an old linked event outside the window.
  const selectedPseudoPayment = useMemo(
    () =>
      value
        ? {
            activity_id: value.kind === "activity" ? value.id : null,
            event_id: value.kind === "event" ? value.id : null,
            birthday_id: value.kind === "birthday" ? value.id : null,
          }
        : null,
    [value],
  );
  const fallbackTarget = usePaymentLinkTarget(selectedPseudoPayment);
  const selected = value
    ? (options.find((o) => o.kind === value.kind && o.id === value.id) ?? fallbackTarget)
    : null;

  const showSuggestions = suggestions.length > 0 && !suggestionsDismissed;

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
      // Inside the payment <form> - swallow the submit and link instead.
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
            flatIndex === activeIndex ? "bg-muted" : "hover:bg-muted",
          )}
        >
          <PaymentLinkIcon kind={option.kind} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">{option.name}</span>
          {option.personIds.length > 0 ? (
            <MemberBadges personIds={option.personIds} size="xs" max={3} className="shrink-0" />
          ) : null}
          {/* Always the full span, never a bare name: not knowing WHEN the
              option happens is how an August payment ends up on a May event. */}
          <span className="shrink-0 text-xs text-muted-foreground">{candidateDetail(option)}</span>
        </button>
      </li>
    );
  };

  const triggerLabel = selected ? (
    <>
      <PaymentLinkIcon kind={selected.kind} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left text-foreground">{selected.name}</span>
    </>
  ) : (
    // Names only what this form actually offers - the expense forms have no
    // birthday column, so promising one there is a dead end.
    <span className="flex-1 truncate text-left text-muted-foreground">
      {(kinds ?? ALL_LINK_KINDS).includes("birthday")
        ? "Aktivnost, događaj ili rođendan…"
        : "Aktivnost ili događaj…"}
    </span>
  );
  const triggerClassName = cn(
    "flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent pr-9 pl-3 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30",
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  );

  return (
    <div className="space-y-2">
      <Label htmlFor="payment-link">Poveži sa (opciono)</Label>
      <div className="relative">
        {onOpenPicker ? (
          // Sheet context: the trigger delegates to the hosting dialog's
          // full-sheet picker sub-view - no popover, no keyboard fight.
          <button
            id="payment-link"
            type="button"
            onClick={onOpenPicker}
            className={triggerClassName}
          >
            {triggerLabel}
          </button>
        ) : (
          /* `modal` - required for touch scrolling of the option list when the
             popover opens inside a dialog/drawer: the dialog's scroll-lock
             otherwise swallows touchmove on the portaled popover content. */
          <Popover open={open} onOpenChange={handleOpenChange} modal>
            <PopoverTrigger asChild>
              <button id="payment-link" type="button" className={triggerClassName}>
                {triggerLabel}
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
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain">
                {filtered.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">Nema rezultata.</p>
                ) : (
                  <>
                    {activityOptions.length > 0 ? (
                      <div>
                        <p className="px-2 pb-1 text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
                          Aktivnosti
                        </p>
                        <ul>{activityOptions.map(renderOption)}</ul>
                      </div>
                    ) : null}
                    {eventOptions.length > 0 ? (
                      <div>
                        <p className="px-2 pb-1 text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
                          Događaji
                        </p>
                        <ul>{eventOptions.map(renderOption)}</ul>
                      </div>
                    ) : null}
                    {birthdayOptions.length > 0 ? (
                      <div>
                        <p className="px-2 pb-1 text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
                          Rođendani
                        </p>
                        <ul>{birthdayOptions.map(renderOption)}</ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
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
      {showSuggestions ? (
        <LinkSuggestionList
          suggestions={suggestions}
          onPick={pick}
          onDismiss={() => setSuggestionsDismissed(true)}
        />
      ) : null}
    </div>
  );
}
