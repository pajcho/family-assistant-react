import { Link } from "@tanstack/react-router";
import { PlusIcon, UserGroupIcon, UserIcon } from "@heroicons/react/24/outline";

import type { ListWithTasks } from "@/types/database";

/**
 * One list as a tile in the two-column grid at the bottom of /tasks.
 *
 * The lists are demoted from "the screen" to "where things live", so a tile has
 * to earn its space in four lines: the name, how much is open, how far along it
 * is, and ONE honest meta line. That last line is the point - a count alone never
 * said which list needed you. It reads "2 sa datumom · 1 kasni" for a list with
 * dated work in it and falls back to the scope for one that has none, because
 * "porodična" is the only other thing worth knowing about a shopping list.
 */

export type ListGridCardProps = {
  list: ListWithTasks;
  /**
   * How many of this list's tasks owe something - counted once, family-wide, by
   * `useOverdueTasks` and handed down. It CANNOT be derived from `list.tasks`:
   * `isTaskOverdue` answers for a task row and is false for every repeat, so a
   * list holding nothing but a daily chore missed all week used to read "0
   * kasni" while /tasks said it was late. One definition of the word, one place
   * it is computed.
   */
  lateCount: number;
};

export function ListGridCard({ list, lateCount }: ListGridCardProps) {
  const active = list.tasks.filter((task) => !task.is_completed);
  const done = list.tasks.length - active.length;
  const dated = active.filter((task) => task.due_date !== null).length;
  const late = lateCount;
  const progress = list.tasks.length > 0 ? Math.round((done / list.tasks.length) * 100) : 0;
  const isFamily = list.scope === "family";

  const meta =
    dated > 0
      ? [`${dated} sa datumom`, late > 0 ? `${late} kasni` : null].filter(Boolean).join(" · ")
      : isFamily
        ? "porodična"
        : "lična";

  return (
    <Link
      to="/tasks/$listId"
      params={{ listId: list.id }}
      className="flex min-h-[74px] flex-col gap-[7px] rounded-xl border border-border bg-card p-2.5 transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:active:scale-100"
    >
      <span className="flex items-start justify-between gap-1.5">
        <span className="min-w-0 flex-1 text-[13.5px] leading-tight font-semibold tracking-[-0.005em]">
          {list.name}
        </span>
        <span className="shrink-0 text-[15px] leading-none font-semibold text-accent-deep tabular-nums">
          {active.length}
        </span>
      </span>

      {/* The bar is decorative - the counts beside it already say everything it
          shows - so it carries no ARIA of its own. */}
      <span aria-hidden="true" className="block h-[3px] overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
      </span>

      <span className="flex items-center gap-1 text-[10.5px] font-normal text-muted-foreground">
        {isFamily ? (
          <UserGroupIcon className="size-3 shrink-0" aria-label="Porodična lista" />
        ) : (
          <UserIcon className="size-3 shrink-0" aria-label="Lična lista" />
        )}
        <span className="min-w-0 truncate">{meta}</span>
      </span>
    </Link>
  );
}

/**
 * The dashed "make another one" row, under the whole grid.
 *
 * It used to be the grid's last CELL, which stopped working the moment the grid
 * grew scope groups: sitting inside "Lične" it read as "add a personal list".
 * One row under everything belongs to no group, and gets a wider target for it.
 */
export function NewListRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-card text-[12.5px] font-semibold text-accent-deep transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:active:scale-100"
    >
      <PlusIcon className="size-4" />
      Nova lista
    </button>
  );
}
