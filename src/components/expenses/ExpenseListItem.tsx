import { useSortable } from "@dnd-kit/sortable";
import {
  Bars3Icon,
  CheckIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import type { Expense } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";

export type ExpenseListItemProps = {
  expense: Expense;
  onMarkPaid: (expense: Expense) => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
};

/**
 * Direct port of `components/expenses/ExpenseListItem.vue`.
 *
 * The Nuxt version delegated drag-to-reorder to `sortablejs` with a CSS
 * class selector (`.drag-handle`). We swap that for `@dnd-kit/sortable`:
 *
 *   • The whole row mounts the sortable ref (`setNodeRef` on the outer
 *     `<li>` wrapper from the parent page), so dnd-kit can animate the
 *     transform across reorders.
 *   • Only the left-side hamburger handle binds `{...attributes}` +
 *     `{...listeners}` — the rest of the row stays non-draggable, which
 *     keeps the kebab dropdown and inline action buttons clickable.
 *
 * Card-style framing (rounded border, `opacity-60` when paid) lives on
 * the parent `<li>` so the wrapper can host the sortable transform style
 * without us re-wrapping the contents here.
 */
export function ExpenseListItem({ expense, onMarkPaid, onEdit, onDelete }: ExpenseListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: expense.id,
  });

  // dnd-kit translates the row via inline transform during drag. Without the
  // transition string the snap-back-to-place after drop looks jumpy.
  //
  // We construct the translate3d string inline rather than pulling in
  // `@dnd-kit/utilities` (a transitive dep that isn't in our package.json).
  // dnd-kit's `CSS.Transform.toString` produces exactly this shape — no
  // scale/rotate is needed for a vertical list reorder.
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800",
        expense.is_paid && "opacity-60",
        // While dragging, hide the original row so only the DragOverlay-equivalent ghost shows
        // (we're not using DragOverlay; this just dims the slot the row is leaving).
        isDragging && "z-10 opacity-50",
      )}
    >
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <button
          type="button"
          aria-label="Premesti"
          className="flex cursor-grab touch-none items-center py-2 text-gray-400 active:cursor-grabbing dark:text-gray-500"
          {...attributes}
          {...listeners}
        >
          <Bars3Icon className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 dark:text-gray-100">{expense.name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{formatAmount(expense.amount)}</p>
          {expense.description ? (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{expense.description}</p>
          ) : null}
          {expense.is_paid && expense.paid_date ? (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Kupljeno {formatDate(expense.paid_date)}
            </p>
          ) : null}
        </div>

        {/* Mobile: single kebab dropdown */}
        <div className="flex shrink-0 sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Akcije">
                <EllipsisVerticalIcon className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!expense.is_paid ? (
                <DropdownMenuItem onSelect={() => onMarkPaid(expense)}>
                  <CheckIcon className="h-4 w-4" />
                  Označi kao plaćeno
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => onEdit(expense)}>
                <PencilIcon className="h-4 w-4" />
                Izmeni
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(expense)}>
                <TrashIcon className="h-4 w-4" />
                Obriši
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Desktop (sm+): inline buttons */}
        <div className="hidden shrink-0 gap-2 sm:flex">
          {!expense.is_paid ? (
            <Button size="sm" onClick={() => onMarkPaid(expense)}>
              Plaćeno
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => onEdit(expense)}>
            <PencilIcon className="mr-1 h-4 w-4" />
            Izmeni
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onDelete(expense)}>
            <TrashIcon className="mr-1 h-4 w-4" />
            Obriši
          </Button>
        </div>
      </div>
    </li>
  );
}
