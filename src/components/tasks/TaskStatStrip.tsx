import { cn } from "@/lib/cn";

/**
 * Three numbers before any detail: how much is late, how much is due today, how
 * much the week holds. It is the first thing on /tasks because it is the answer
 * to the question the screen exists for - the old index made you open a list to
 * find out that anything was wrong at all.
 *
 * Kasni is the only tile with colour, and it DISAPPEARS at zero rather than
 * sitting there as a reassuring 0: a permanent red-shaped slot stops meaning
 * anything the third time you see it empty.
 *
 * Each tile is a toggle that scopes the sections below it, so the strip is a
 * filter as well as a summary. Tapping the active one clears it.
 */

export type TaskStatKey = "late" | "today" | "week";

export type TaskStatStripProps = {
  late: number;
  today: number;
  week: number;
  /** Null = the default view (Kasni + Danas + Sutra). */
  active: TaskStatKey | null;
  onSelect: (key: TaskStatKey | null) => void;
};

const LABEL: Record<TaskStatKey, string> = {
  late: "Kasni",
  today: "Danas",
  week: "Nedelja",
};

export function TaskStatStrip({ late, today, week, active, onSelect }: TaskStatStripProps) {
  const tiles: Array<{ key: TaskStatKey; value: number }> = [
    ...(late > 0 ? [{ key: "late" as const, value: late }] : []),
    { key: "today", value: today },
    { key: "week", value: week },
  ];

  return (
    <div
      role="group"
      aria-label="Pregled zadataka"
      className={cn("grid gap-1.5", tiles.length === 3 ? "grid-cols-3" : "grid-cols-2")}
    >
      {tiles.map((tile) => {
        const isActive = active === tile.key;
        const alert = tile.key === "late";
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(isActive ? null : tile.key)}
            className={cn(
              "rounded-xl border px-2.5 py-2 text-left transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              alert
                ? "border-neg/40 bg-neg-soft"
                : isActive
                  ? "border-accent bg-accent-soft"
                  : "border-border bg-card hover:bg-muted",
              alert && isActive && "border-neg",
            )}
          >
            <span
              className={cn(
                "block text-[10.5px] font-bold tracking-[0.08em] uppercase",
                alert ? "text-neg" : "text-muted-foreground",
              )}
            >
              {LABEL[tile.key]}
            </span>
            <span
              className={cn(
                "block text-[19px] leading-tight font-semibold tracking-tight tabular-nums",
                alert ? "text-neg" : "text-foreground",
              )}
            >
              {tile.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
