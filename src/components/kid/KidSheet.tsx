import { useRef } from "react";
import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { KidTile } from "@/components/kid/KidUi";

/**
 * The kid shell's only overlay: a bottom sheet.
 *
 * Deliberately NOT the app's `DetailSheet` / shadcn dialog - this world has its
 * own radii, its own surface colours and no icon buttons at all. It is also
 * deliberately flat: the kid shell has no sub-views, so there is no sheet stack
 * and no "Nazad". Every sheet closes with `Zatvori`, tapping the backdrop,
 * Escape, or swiping it down.
 *
 * The behaviour comes from Vaul's unstyled primitives - the same library the
 * grown-up app's drawers run on - so the swipe-down, the scroll-vs-drag
 * arbitration inside a long sheet, focus trapping and the exit animation are
 * the battle-tested ones. Only the look is the kid shell's own.
 *
 * Height follows the content (house rule), capped at 80% of the screen so a
 * long sheet still shows the backdrop above it and reads as a sheet.
 */
export function KidSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-[rgb(12_16_38/0.48)]" />
        <Drawer.Content
          ref={panelRef}
          // The sheet has no description element; saying so explicitly keeps
          // Radix from warning about a missing one.
          aria-describedby={undefined}
          // Focus moves into the sheet on open so a keyboard user is not left
          // behind on the card that opened it - the panel itself, not its
          // first button, so nothing lights up with a focus ring on a tap.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            panelRef.current?.focus();
          }}
          className="kid-font fixed inset-x-0 bottom-0 z-50 flex max-h-[80%] flex-col rounded-t-[26px] bg-[var(--k-card)] text-[var(--k-ink)] outline-none"
        >
          {/* The scroll lives on this inner box, not on the panel: Vaul hangs
              a tall pseudo-element under the panel (it covers the gap when a
              drag overshoots), and inside a scrolling panel that would add
              two screens of empty scroll below the content. */}
          <div className="kid-scroll min-h-0 overflow-y-auto px-[18px] pt-2.5 pb-[calc(env(safe-area-inset-bottom)+18px)]">
            <span
              aria-hidden="true"
              className="mx-auto mt-0.5 mb-3.5 block h-[5px] w-10 rounded-full bg-[var(--k-line)]"
            />
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** The sheet's name. Radix wires it to the dialog's `aria-labelledby`. */
export function KidSheetTitle({ emoji, title }: { emoji: string; title: string }) {
  return (
    <Drawer.Title className="mb-1.5 flex items-center gap-2.5 text-[18px] font-bold">
      <KidTile emoji={emoji} className="size-11 text-[22px]" />
      <span className="min-w-0 flex-1">{title}</span>
    </Drawer.Title>
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
  return (
    <KidSheet open={open} onClose={onClose}>
      <KidSheetTitle emoji={emoji} title={title} />
      {rows.map((row, index) => (
        <KidSheetRow key={`${row.icon}-${index}`} icon={row.icon}>
          {row.text}
        </KidSheetRow>
      ))}
      <KidSheetButton onClick={onClose}>Zatvori</KidSheetButton>
    </KidSheet>
  );
}
