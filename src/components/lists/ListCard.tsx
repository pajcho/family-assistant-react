import {
  ArrowDownTrayIcon,
  ArrowsPointingOutIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TableCellsIcon,
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
import { previewLine } from "@/components/common/MarkdownText";
import { cn } from "@/lib/cn";
import { exportListAsCsv, exportListAsMarkdown } from "@/lib/listExport";
import type { ListItem, ListWithItems } from "@/types/database";

export type ListCardProps = {
  list: ListWithItems;
  onEdit: (list: ListWithItems) => void;
  onDelete: (list: ListWithItems) => void;
  onAddItem: (listId: string, name: string) => void;
  onToggleItem: (item: ListItem) => void;
  /** Apply edits from the per-item popup (name + optional description). */
  onUpdateItem: (item: ListItem, payload: { name: string; description: string | null }) => void;
  onDeleteItem: (item: ListItem) => void;
  onClearCompleted: (listId: string) => void;
  /**
   * Whether the card body (items + add-input) is hidden. Optional —
   * cards that aren't part of the /lists overview (none today, but the
   * door is open) keep behaving as fully expanded.
   */
  collapsed?: boolean;
  /** Toggle the collapsed state for this list id. */
  onToggleCollapsed?: (listId: string) => void;
};

export function ListCard({
  list,
  onEdit,
  onDelete,
  onAddItem,
  onToggleItem,
  onUpdateItem,
  onDeleteItem,
  onClearCompleted,
  collapsed = false,
  onToggleCollapsed,
}: ListCardProps) {
  const active = list.list_items.filter((i) => !i.is_completed);
  const completed = list.list_items.filter((i) => i.is_completed);

  const ScopeIcon = list.scope === "family" ? UserGroupIcon : UserIcon;
  const scopeLabel = list.scope === "family" ? "Porodica" : "Lično";

  // Treat the collapse affordance as available only when a toggle handler
  // was actually wired in. Avoids dead chevrons in any surface that mounts
  // the card without collapse support.
  const collapsible = typeof onToggleCollapsed === "function";
  const handleToggleCollapsed = () => {
    if (collapsible) onToggleCollapsed?.(list.id);
  };

  // When collapsed, surface a hint about how many active+completed items
  // are tucked away so users don't need to expand just to see "is there
  // anything in here?". When expanded the header keeps its existing
  // single-count ("N stavki") to preserve the current layout.
  const collapsedSummary = (() => {
    const parts: string[] = [];
    parts.push(`${active.length} ${active.length === 1 ? "aktivna" : "aktivnih"}`);
    if (completed.length > 0) parts.push(`${completed.length} završeno`);
    return parts.join(" · ");
  })();

  const bodyId = `list-body-${list.id}`;

  return (
    <section className="flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <header
        className={cn(
          "flex items-start gap-2 px-4 py-3",
          // The body's top border doubles as the header's separator when
          // we render the body. When collapsed the body is gone, so drop
          // the bottom border to avoid a stray hairline.
          !collapsed && "border-b border-gray-100 dark:border-gray-700",
        )}
      >
        {/* Collapse chevron sits before the name so the "tap me to
            expand/collapse" affordance lines up with the row of icons
            below. Same icon used inside ListBody's "Prikaži završene"
            toggle for a consistent visual language. */}
        {collapsible ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 mt-0.5 h-7 w-7 shrink-0"
            aria-label={collapsed ? `Razvij "${list.name}"` : `Skupi "${list.name}"`}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={handleToggleCollapsed}
          >
            {collapsed ? (
              <ChevronRightIcon className="h-5 w-5" />
            ) : (
              <ChevronDownIcon className="h-5 w-5" />
            )}
          </Button>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Title is also a tap target when collapsible so users don't
              have to aim for the small chevron. We keep `<h2>` as the
              outer element for the document outline and wrap an inner
              <button> when collapsible — the button is unstyled visually
              but gives screen readers an explicit affordance. */}
          {collapsible ? (
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              <button
                type="button"
                onClick={handleToggleCollapsed}
                className="block w-full truncate text-left hover:text-gray-700 dark:hover:text-gray-300"
                aria-label={collapsed ? `Razvij "${list.name}"` : `Skupi "${list.name}"`}
              >
                {list.name}
              </button>
            </h2>
          ) : (
            <h2 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {list.name}
            </h2>
          )}
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
              {collapsed
                ? collapsedSummary
                : `${active.length} ${active.length === 1 ? "stavka" : "stavki"}`}
            </span>
          </div>
          {list.description && previewLine(list.description) ? (
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
              {previewLine(list.description)}
            </p>
          ) : null}
        </div>

        {/* Open-full-page button — primary affordance for the "I'm shopping,
            give me just this list" use case. The dropdown still covers edit
            and delete; this is the one-tap shortcut. */}
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Otvori listu "${list.name}"`}>
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
            {/* Export entries — both formats live in the same menu so
                users discover them together. Disabled when the list has
                no items at all (active + completed) — the export would
                be a literal empty file. */}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => exportListAsMarkdown(list)}
              disabled={list.list_items.length === 0}
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Eksportuj (Markdown)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => exportListAsCsv(list)}
              disabled={list.list_items.length === 0}
            >
              <TableCellsIcon className="h-4 w-4" />
              Eksportuj (CSV)
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

      {/* Body is unmounted (not just hidden) when collapsed so the items
          don't participate in tab order or the masonry's intrinsic-height
          calculation. The chevron's `aria-expanded`/`aria-controls` above
          still wires up the expected screen-reader semantics. */}
      {collapsed ? null : (
        <div id={bodyId}>
          <ListBody
            list={list}
            onAddItem={onAddItem}
            onToggleItem={onToggleItem}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
          />
        </div>
      )}
    </section>
  );
}
