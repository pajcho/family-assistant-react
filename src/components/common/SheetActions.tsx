import { Fragment } from "react";
import type { ComponentType, SVGProps } from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsDesktop } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/cn";

/**
 * Shared "more actions" plumbing for detail sheets (payments, events,
 * birthdays): ONE item list feeds both surfaces — the desktop kebab dropdown
 * and the mobile "Opcije" sub-view rendered INSIDE the same sheet.
 *
 * The sub-view (not a second drawer!) is deliberate: two independent vaul
 * roots fight over the body scroll lock — closing the top one unlocks the
 * page under the still-open bottom one and kills its drag-to-dismiss.
 */
export type SheetAction = {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  destructive?: boolean;
  /** Hairline above this item (destructive actions come last, separated). */
  separatorBefore?: boolean;
  onSelect: () => void;
};

/**
 * The kebab trigger: anchored dropdown on desktop (pointer is precise), a
 * plain button that flips the sheet into its "actions" sub-view on mobile.
 */
export function SheetActionsKebab({
  items,
  disabled = false,
  onOpenActions,
}: {
  items: SheetAction[];
  disabled?: boolean;
  /** Mobile tap — the owning sheet switches to its "Opcije" sub-mode. */
  onOpenActions: () => void;
}) {
  const isDesktop = useIsDesktop();
  if (items.length === 0) return null;

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Više opcija"
      className="shrink-0 text-gray-500 dark:text-gray-400"
      disabled={disabled}
      onClick={isDesktop ? undefined : onOpenActions}
    >
      <EllipsisVerticalIcon className="size-5" />
    </Button>
  );

  if (!isDesktop) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={item.destructive ? "destructive" : "default"}
              onClick={item.onSelect}
              disabled={disabled}
            >
              <item.icon className="size-4" />
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The "Opcije" sub-view body — big, thumb-friendly rows. */
export function SheetActionList({
  items,
  disabled = false,
}: {
  items: SheetAction[];
  disabled?: boolean;
}) {
  return (
    <div className="-mx-2">
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.separatorBefore ? (
            <div className="my-1.5 h-px bg-gray-100 dark:bg-gray-700/60" />
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={item.onSelect}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2 py-3 text-[15px] font-medium transition-colors disabled:opacity-50",
              item.destructive
                ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                : "text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/40",
            )}
          >
            <item.icon
              className={cn("size-5", !item.destructive && "text-gray-400 dark:text-gray-500")}
            />
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
