import * as React from "react";
import { CheckIcon, PencilIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { ListItem } from "@/types/database";

export type ListItemRowProps = {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  onRename: (item: ListItem, name: string) => void;
  onDelete: (item: ListItem) => void;
};

/**
 * One row inside a list — checkbox + name + (desktop-only) edit/delete icons.
 *
 * Returns a `<div>` rather than `<li>`; the parent owns the list element so
 * it can also wrap the row in a swipe-gesture container without nesting
 * invalid `<ul><div><li>` markup.
 *
 * Touch devices (`pointer: coarse`): inline edit/delete buttons are
 * hidden; the user reaches the same actions via tap-to-edit and the
 * swipe gestures handled by `SwipeableListItem`.
 *
 * Mouse devices (`pointer: fine`): the icons fade in on hover / focus-within
 * so the row stays clean by default and reveals the actions when the user
 * reaches it. We gate on pointer type rather than viewport width so a
 * touchscreen tablet with a 1024px viewport still gets the touch UX, and
 * a desktop with a narrow window still gets the buttons.
 */
export function ListItemRow({ item, onToggle, onRename, onDelete }: ListItemRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.name);

  React.useEffect(() => {
    if (!editing) setDraft(item.name);
  }, [item.name, editing]);

  const beginEdit = () => {
    setDraft(item.name);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(item.name);
    setEditing(false);
  };

  const commitEdit = () => {
    const next = draft.trim();
    if (!next || next === item.name) {
      cancelEdit();
      return;
    }
    onRename(item, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 dark:bg-gray-800">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          autoFocus
          className="h-8 flex-1"
        />
        <Button size="icon-sm" variant="ghost" onClick={commitEdit} aria-label="Sačuvaj">
          <CheckIcon className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={cancelEdit} aria-label="Otkaži">
          <XMarkIcon className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Touch-target sizing
  // ------------------
  // The row used `items-center gap-2 py-1.5` which produced a ~32px-tall row
  // with only ~8px between the checkbox and the edit-button. On phones any
  // tap-bias to the right of the 20px checkbox landed in the button and
  // opened the inline-edit input — annoying when you meant to check off
  // an item. The new layout:
  //
  //   <div items-stretch>     ← children share full row height
  //     <label>               ← catches checkbox-area taps incl. right buffer
  //       <input checkbox />
  //     </label>
  //     <button name>         ← starts after the label, no gap to bridge
  //   </div>
  //
  // Mobile gets py-3 on each region (label + button) which yields a 44px-tall
  // row hitting Apple's HIG floor, plus a 12px right-padding inside the label
  // so a near-miss to the right of the checkbox still toggles. Mouse devices
  // stay compact via the pointer-fine variant (py-1.5 + minimal padding).
  return (
    <div className="group flex items-stretch rounded-md bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50">
      <label
        className="flex shrink-0 cursor-pointer items-center py-3 pl-3 pr-4 pointer-fine:py-1.5 pointer-fine:pl-2 pointer-fine:pr-2"
        aria-label={
          item.is_completed ? `Vrati "${item.name}" u aktivne` : `Završi "${item.name}"`
        }
      >
        {/* Use a real <input type="checkbox"> for accessibility + native a11y.
            Wrapping it in a <label> means clicks anywhere inside the label
            (including the generous mobile padding) proxy through to the
            checkbox — no extra JS needed. */}
        <input
          type="checkbox"
          checked={item.is_completed}
          onChange={() => onToggle(item)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
        />
      </label>
      <button
        type="button"
        onClick={beginEdit}
        className={cn(
          "min-w-0 flex-1 truncate py-3 pr-3 text-left text-sm pointer-fine:py-1.5 pointer-fine:pr-2",
          item.is_completed
            ? "text-gray-400 line-through dark:text-gray-500"
            : "text-gray-900 dark:text-gray-100",
        )}
      >
        {item.name}
      </button>
      {/* Inline action buttons — mouse-only. Touch users get the same
          operations via tap-to-edit + swipe gestures, so the icons would
          just be visual noise. The `pointer-fine` variant is defined in
          src/styles/index.css and maps to `@media (pointer: fine)`. */}
      <div className="hidden shrink-0 items-center gap-0.5 pr-1 pointer-fine:flex pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={beginEdit}
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
    </div>
  );
}
