import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { KidTile } from "@/components/kid/KidUi";

/**
 * The kid shell's only overlay: a bottom sheet.
 *
 * Deliberately NOT the app's `DetailSheet` / shadcn dialog - this world has its
 * own radii, its own surface colours and no icon buttons at all. It is also
 * deliberately flat: the kid shell has no sub-views, so there is no sheet stack
 * and no "Nazad". Every sheet closes with `Zatvori`, tapping the backdrop, or
 * Escape.
 *
 * Height follows the content (house rule), capped at 80% of the screen so a
 * long sheet still shows the backdrop above it and reads as a sheet.
 */
export function KidSheet({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Id of the element naming the sheet - usually the `KidSheetTitle`. */
  labelledBy?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the sheet on open so a keyboard user
  // is not left behind on the card that opened it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kid-fade-in fixed inset-0 z-50 flex items-end bg-[rgb(12_16_38/0.48)]">
      {/* The backdrop is a real button, not a div with a click handler: that
          way tapping outside and reaching it with a keyboard are the same
          control, and there is nothing for a screen reader to trip over. */}
      <button
        type="button"
        aria-label="Zatvori"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="kid-sheet-in kid-scroll kid-font relative max-h-[80%] w-full overflow-y-auto rounded-t-[26px] bg-[var(--k-card)] px-[18px] pt-2.5 pb-[calc(env(safe-area-inset-bottom)+18px)] text-[var(--k-ink)] outline-none"
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-0.5 mb-3.5 block h-[5px] w-10 rounded-full bg-[var(--k-line)]"
        />
        {children}
      </div>
    </div>
  );
}

export function KidSheetTitle({ emoji, title, id }: { emoji: string; title: string; id?: string }) {
  return (
    <h2 id={id} className="mb-1.5 flex items-center gap-2.5 text-[18px] font-bold">
      <KidTile emoji={emoji} className="size-11 text-[22px]" />
      <span className="min-w-0 flex-1">{title}</span>
    </h2>
  );
}

/** One fact line inside a sheet: a small glyph gutter and the text. */
function KidSheetRow({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-t-[1.5px] border-[var(--k-line)] px-0.5 py-3 text-[14px] font-normal first-of-type:mt-1.5 first-of-type:border-t-0">
      <span aria-hidden="true" className="w-6 flex-none text-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** The primary (and usually only) button in a sheet. */
export function KidSheetButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-3.5 w-full rounded-2xl bg-[var(--k-accent)] px-4 py-3.5 text-[15.5px] font-semibold text-[var(--k-accent-ink)] transition-transform duration-100 active:scale-[0.97] disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * A sheet made of a title, some fact rows and `Zatvori` - the shape every
 * detail in the kid shell takes. Read-only by construction: there is no edit,
 * no delete, and no second action.
 */
export function KidDetailSheet({
  open,
  onClose,
  emoji,
  title,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  emoji: string;
  title: string;
  rows: ReadonlyArray<{ icon: string; text: string }>;
}) {
  const titleId = useId();
  return (
    <KidSheet open={open} onClose={onClose} labelledBy={titleId}>
      <KidSheetTitle id={titleId} emoji={emoji} title={title} />
      {rows.map((row, index) => (
        <KidSheetRow key={`${row.icon}-${index}`} icon={row.icon}>
          {row.text}
        </KidSheetRow>
      ))}
      <KidSheetButton onClick={onClose}>Zatvori</KidSheetButton>
    </KidSheet>
  );
}
