import {
  ArrowsPointingOutIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListBody } from "@/components/lists/ListBody";
import { cn } from "@/lib/cn";
import type { ListItem, ListWithItems } from "@/types/database";

export type ListCardProps = {
  list: ListWithItems;
  onEdit: (list: ListWithItems) => void;
  onDelete: (list: ListWithItems) => void;
  onAddItem: (listId: string, name: string) => void;
  onToggleItem: (item: ListItem) => void;
  onRenameItem: (item: ListItem, name: string) => void;
  onDeleteItem: (item: ListItem) => void;
  onClearCompleted: (listId: string) => void;
};

export function ListCard({
  list,
  onEdit,
  onDelete,
  onAddItem,
  onToggleItem,
  onRenameItem,
  onDeleteItem,
  onClearCompleted,
}: ListCardProps) {
  const active = list.list_items.filter((i) => !i.is_completed);
  const completed = list.list_items.filter((i) => i.is_completed);

  const ScopeIcon = list.scope === "family" ? UserGroupIcon : UserIcon;
  const scopeLabel = list.scope === "family" ? "Porodica" : "Lično";

  return (
    <section className="flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <header className="flex items-start gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
            {list.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                list.scope === "family"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  : "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
              )}
            >
              <ScopeIcon className="h-3.5 w-3.5" />
              {scopeLabel}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {active.length} {active.length === 1 ? "stavka" : "stavki"}
            </span>
          </div>
        </div>

        {/* Open-full-page button — primary affordance for the "I'm shopping,
            give me just this list" use case. The dropdown still covers edit
            and delete; this is the one-tap shortcut. */}
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label={`Otvori listu "${list.name}"`}
        >
          <Link to="/lists/$listId" params={{ listId: list.id }}>
            <ArrowsPointingOutIcon className="h-5 w-5" />
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Akcije liste">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(list)}>
              <PencilIcon className="h-4 w-4" />
              Izmeni listu
            </DropdownMenuItem>
            {completed.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onClearCompleted(list.id)}>
                  <TrashIcon className="h-4 w-4" />
                  Obriši završene ({completed.length})
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(list)}>
              <TrashIcon className="h-4 w-4" />
              Obriši listu
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ListBody
        list={list}
        onAddItem={onAddItem}
        onToggleItem={onToggleItem}
        onRenameItem={onRenameItem}
        onDeleteItem={onDeleteItem}
      />
    </section>
  );
}
