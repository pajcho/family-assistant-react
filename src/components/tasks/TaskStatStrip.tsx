import { Link } from "@tanstack/react-router";

import { SMART_LISTS } from "@/components/tasks/smartLists";
import type { SmartListKey } from "@/components/tasks/smartLists";
import { cn } from "@/lib/cn";

/**
 * The four cross-list cuts, with their counts, at the top of /tasks - the mobile
 * face of the sidebar's "Pregled" group, so both breakpoints offer exactly the
 * same four ways in and a person moving between phone and laptop finds the same
 * vocabulary.
 *
 * It used to be three tiles (Kasni / Danas / Nedelja) that FILTERED the sections
 * below. That made the strip a summary and a filter at once, and it named three
 * things the sidebar had never heard of. Now each tile is a destination: the
 * numbers still answer "is anything wrong", and tapping one opens the full view.
 *
 * Kasni is the only tile with colour, and it DISAPPEARS at zero rather than
 * sitting there as a reassuring 0: a permanent red-shaped slot stops meaning
 * anything the third time you see it empty.
 */

export type TaskStatStripProps = {
  counts: Record<SmartListKey, number>;
};

export function TaskStatStrip({ counts }: TaskStatStripProps) {
  const tiles = SMART_LISTS.filter((entry) => !entry.hideWhenEmpty || counts[entry.key] > 0);

  return (
    // Two columns, not four: four tiles across a 375px phone leaves each one
    // narrower than the word inside it. Three tiles (no Kasni) leave the last
    // one full width, which reads as deliberate rather than broken.
    <div className="grid grid-cols-2 gap-1.5">
      {tiles.map((entry) => {
        const alert = entry.key === "late";
        return (
          <Link
            key={entry.key}
            to={entry.to}
            className={cn(
              "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              alert ? "border-neg/40 bg-neg-soft" : "border-border bg-card hover:bg-muted",
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
                "shrink-0 text-[19px] leading-none font-semibold tracking-tight tabular-nums",
                alert ? "text-neg" : "text-foreground",
              )}
            >
              {counts[entry.key]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
