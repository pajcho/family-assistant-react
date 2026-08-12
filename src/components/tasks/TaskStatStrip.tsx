import { SMART_LISTS } from "@/components/tasks/smartLists";
import type { SmartListKey } from "@/components/tasks/smartLists";
import { cn } from "@/lib/cn";

/**
 * The four cross-list cuts, with their counts, at the top of /tasks - the mobile
 * face of the sidebar's "Pregled" group, so both breakpoints offer exactly the
 * same four ways in and a person moving between phone and laptop finds the same
 * vocabulary.
 *
 * Tapping one SWAPS the content below rather than opening a page of its own.
 * Every one of these views wants the same person rail and the same kind of rows,
 * so sending you to a separate screen only cost you the filter you had picked
 * and made you press back to come home. Tapping the active tile again returns to
 * the default - what is late, today and tomorrow.
 *
 * (The routes still exist: the desktop sidebar links to them and a deep link has
 * to land somewhere. This is only what the tile does.)
 *
 * Kasni is the only tile with colour, and it DISAPPEARS at zero rather than
 * sitting there as a reassuring 0: a permanent red-shaped slot stops meaning
 * anything the third time you see it empty.
 */

export type TaskStatStripProps = {
  counts: Record<SmartListKey, number>;
  /** Which cut is showing, or null for the default dated view. */
  active: SmartListKey | null;
  onSelect: (next: SmartListKey | null) => void;
};

export function TaskStatStrip({ counts, active, onSelect }: TaskStatStripProps) {
  const tiles = SMART_LISTS.filter((entry) => !entry.hideWhenEmpty || counts[entry.key] > 0);

  return (
    // Two columns, not four: four tiles across a 375px phone leaves each one
    // narrower than the word inside it. Three tiles (no Kasni) leave the last
    // one full width, which reads as deliberate rather than broken.
    <div className="grid grid-cols-2 gap-1.5">
      {tiles.map((entry) => {
        const alert = entry.key === "late";
        const selected = active === entry.key;
        return (
          <button
            key={entry.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : entry.key)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              // Every tile rests as a plain card, so "selected" is the only
              // thing a tint means. Kasni used to sit permanently red-washed,
              // which left its selected state to a border shade nobody could
              // pick out. Its red now lives in the label and the number - which
              // is where the signal belongs - and it tints when chosen, in its
              // own colour rather than the accent.
              selected
                ? alert
                  ? "border-neg bg-neg-soft"
                  : "border-accent bg-accent-soft"
                : "border-border bg-card hover:bg-muted",
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <entry.icon
                className={cn("size-4 shrink-0", alert ? "text-neg" : "text-muted-foreground")}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "truncate text-[10.5px] font-bold tracking-[0.08em] uppercase",
                  alert ? "text-neg" : "text-muted-foreground",
                )}
              >
                {entry.label}
              </span>
            </span>
            <span
              className={cn(
                // 15px. The count is a reading, not a headline - it sits beside
                // a 10.5px label on a half-width tile, and Zavrseno counts a
                // whole month of ticks, so it has to stay legible at four
                // digits without pushing its own label out.
                "shrink-0 text-[15px] leading-none tracking-tight tabular-nums",
                // A count is a VALUE, which the type scale sets in normal - and
                // four bold numbers in a row read as four things shouting. The
                // selected one steps up to semibold, so weight says "this is the
                // one you are looking at" rather than decorating all of them.
                selected ? "font-semibold" : "font-normal",
                alert ? "text-neg" : "text-foreground",
              )}
            >
              {counts[entry.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
