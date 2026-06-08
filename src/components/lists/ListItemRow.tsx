import { Bars3Icon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

import { Button } from "@/components/ui/button";
import { Linkify } from "@/components/common/Linkify";
import { previewLine } from "@/components/common/MarkdownText";
import { cn } from "@/lib/cn";
import type { ListItem } from "@/types/database";

/**
 * Bindings forwarded from `useSortable` so this row can host a drag
 * handle. Only the listeners/attributes for the handle button are
 * needed — the row's outer ref + transform are applied by the parent
 * `SortableRow` wrapper.
 */
export type DragHandleBindings = {
  listeners: SyntheticListenerMap | undefined;
  attributes: DraggableAttributes;
};

export type ListItemRowProps = {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  /** Open the full edit/view dialog for this item (replaces the old inline edit). */
  onOpen: (item: ListItem) => void;
  onDelete: (item: ListItem) => void;
  /**
   * When provided, the row renders a drag handle on its right side and
   * forwards the dnd-kit listeners onto that button. Omit to render a
   * non-draggable row (smart-sort mode, completed items, etc.).
   */
  dragHandle?: DragHandleBindings;
};

/**
 * One row inside a list — checkbox + name (+ description preview) +
 * (desktop-only) edit/delete icons.
 *
 * Returns a `<div>` rather than `<li>`; the parent owns the list element so
 * it can also wrap the row in a swipe-gesture container without nesting
 * invalid `<ul><div><li>` markup.
 *
 * Click behaviour
 *   • Checkbox area  → toggle is_completed (label proxy makes a generous
 *                      tap target on phones)
 *   • Text area      → open the item dialog (was inline edit before; the
 *                      dialog now hosts rename + description editing)
 *   • Pencil button  → same as text area, kept for the desktop mouse-over
 *                      shortcut
 *   • Trash button   → request delete (handled by parent confirm dialog)
 *
 * Touch devices (`pointer: coarse`): inline edit/delete buttons are
 * hidden; the user reaches the same actions via tap-to-open and the
 * swipe gestures handled by `SwipeableListItem`.
 *
 * Mouse devices (`pointer: fine`): the icons fade in on hover / focus-within
 * so the row stays clean by default and reveals the actions when the user
 * reaches it. We gate on pointer type rather than viewport width so a
 * touchscreen tablet with a 1024px viewport still gets the touch UX, and
 * a desktop with a narrow window still gets the buttons.
 */
export function ListItemRow({ item, onToggle, onOpen, onDelete, dragHandle }: ListItemRowProps) {
  // Reduce the (possibly multi-line, possibly Markdown) description to a
  // single trimmed line for the row preview. Empty after stripping ⇒ no
  // preview row, which keeps the gap between checkbox + label tight.
  const descriptionPreview = previewLine(item.description);

  return (
    <div className="group flex items-stretch rounded-md bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50">
      <label
        className="flex shrink-0 cursor-pointer items-center py-3 pl-3 pr-4 pointer-fine:py-1.5 pointer-fine:pl-2 pointer-fine:pr-2"
        aria-label={item.is_completed ? `Vrati "${item.name}" u aktivne` : `Završi "${item.name}"`}
      >
        <input
          type="checkbox"
          checked={item.is_completed}
          onChange={() => onToggle(item)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
        />
      </label>
      {/* Hit-target scoping: same approach as before — the wrapper owns the
          flex-1 stretch (with inert right padding) while the button shrinks
          to text width so only the visible label area is a tap target.
          `items-stretch` lets the button still fill the row vertically so
          the area above/below the text remains forgiving. */}
      <div className="flex min-w-0 flex-1 items-stretch pr-3 pointer-fine:pr-2">
        {/* role="button" rather than a real <button>: the title may contain
            autolinked URLs (<a> elements), which HTML forbids nesting inside
            a <button>. We re-add the button keyboard contract (Enter/Space)
            and gate it on the row itself so key presses on a focused inner
            link aren't hijacked into opening the dialog. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(item)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(item);
            }
          }}
          className={cn(
            "flex max-w-full min-w-0 cursor-pointer flex-col justify-center rounded py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 pointer-fine:py-1.5",
            item.is_completed
              ? "text-gray-400 dark:text-gray-500"
              : "text-gray-900 dark:text-gray-100",
          )}
          aria-label={`Otvori detalje za "${item.name}"`}
        >
          <span className={cn("truncate", item.is_completed && "line-through")}>
            <Linkify
              text={item.name}
              linkClassName={cn(
                "underline underline-offset-2",
                item.is_completed
                  ? "text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
                  : "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
              )}
            />
          </span>
          {descriptionPreview ? (
            <span
              className={cn(
                "truncate text-xs",
                item.is_completed
                  ? "text-gray-300 dark:text-gray-600"
                  : "text-gray-500 dark:text-gray-400",
              )}
            >
              {descriptionPreview}
            </span>
          ) : null}
        </div>
      </div>
      {/* Inline action buttons — mouse-only. Touch users get the same
          operations via tap-to-open + swipe gestures, so the icons would
          just be visual noise. The `pointer-fine` variant is defined in
          src/styles/index.css and maps to `@media (pointer: fine)`. */}
      <div className="hidden shrink-0 items-center gap-0.5 pr-1 pointer-fine:flex pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onOpen(item)}
          aria-label="Izmeni stavku"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onDelete(item)}
          aria-label="Obriši stavku"
        >
          <TrashIcon className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
        </Button>
      </div>
      {/* Drag handle — only rendered when the list is reorderable
          (smart-sort off + active section). Lives in its own slot so it
          stays visible on touch devices where the pencil/trash buttons
          are hidden; on desktop it joins the hover/focus reveal so the
          row stays clean by default. The listeners come from the parent
          `SortableRow`'s `useSortable()` call — attaching them only to
          the handle button (not the row body) keeps tap-to-open, swipe
          gestures, and the checkbox label all working untouched. */}
      {dragHandle ? (
        <div className="flex shrink-0 items-center pr-2 pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`Premesti "${item.name}"`}
            className="flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
            // Stop the pointerdown from reaching `SwipeableListItem`, which
            // is the row's outer `<li>` on touch devices and would
            // otherwise see the drag's pointer-move stream as a possible
            // horizontal swipe. dnd-kit's own handler still fires because
            // we re-invoke it after stopping propagation.
            onPointerDown={(e) => {
              e.stopPropagation();
              dragHandle.listeners?.onPointerDown?.(e);
            }}
          >
            <Bars3Icon className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
