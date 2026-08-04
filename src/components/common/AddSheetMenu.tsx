import type { ComponentType, SVGProps } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
/**
 * The shared multi-option "Dodaj" affordance: a labelled header dropdown on
 * desktop (lg+).
 *
 * Desktop only since the redesign - below `lg` the global "+" in the bottom
 * bar covers every add flow from every screen, so the page-level FAB was
 * removed rather than left to compete with it. Pages with a single add action
 * keep the plain `AddButton`.
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
  return (
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
  );
}
