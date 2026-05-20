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

  return (
    <div className="group flex items-center gap-2 rounded-md bg-white px-2 py-1.5 hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50">
      {/* Use a real <input type="checkbox"> for accessibility + native a11y */}
      <input
        type="checkbox"
        checked={item.is_completed}
        onChange={() => onToggle(item)}
        aria-label={
          item.is_completed ? `Vrati "${item.name}" u aktivne` : `Završi "${item.name}"`
        }
        className="h-5 w-5 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
      />
      <button
        type="button"
        onClick={beginEdit}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
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
      <div className="hidden shrink-0 items-center gap-0.5 pointer-fine:flex pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
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
