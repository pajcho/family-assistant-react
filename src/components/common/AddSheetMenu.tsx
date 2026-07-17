import { useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

/**
 * The shared multi-option "Dodaj" affordance. On mobile the FAB opens a
 * bottom sheet with the same tile grid as the nav's "Više" menu (one tile per
 * option, colored icon circle + label); on desktop (lg+) it's a labelled
 * header dropdown. Pages with a single add action keep the plain `AddButton`.
 */
export type AddSheetMenuItem = {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClass: string;
  iconBgClass: string;
  onSelect: () => void;
};

export type AddSheetMenuProps = {
  items: readonly AddSheetMenuItem[];
  /** Sheet title + FAB aria-label. */
  title?: string;
};

export function AddSheetMenu({ items, title = "Dodaj" }: AddSheetMenuProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      {/* Desktop (lg+): labelled header dropdown. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" className="hidden lg:inline-flex">
            <PlusIcon className="mr-2 h-5 w-5" />
            {title}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            {items.map((item) => (
              <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                <item.icon className={item.iconClass} />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Below lg: FAB → bottom sheet with the "Više" tile grid. */}
      <Button
        type="button"
        size="icon-lg"
        aria-label={title}
        onClick={() => setSheetOpen(true)}
        className="fixed right-4 bottom-24 z-30 size-14 rounded-full shadow-lg lg:hidden"
      >
        <PlusIcon className="size-6" />
      </Button>
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-left text-lg leading-none">{title}</DrawerTitle>
          </DrawerHeader>
          <div className="grid grid-cols-3 gap-2 px-4 pt-1 pb-8">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                  item.onSelect();
                }}
                className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 px-2 py-4 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:border-gray-700 dark:hover:bg-gray-700/40"
              >
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-full",
                    item.iconBgClass,
                  )}
                >
                  <item.icon className={cn("size-5", item.iconClass)} />
                </span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
