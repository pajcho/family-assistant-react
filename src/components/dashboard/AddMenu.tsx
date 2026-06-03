import { BanknotesIcon, CakeIcon, CalendarIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The dashboard's "Dodaj" affordance — a menu over the three agenda types.
 * Matches `AddButton`'s responsive placement: a labelled header dropdown on
 * desktop (md+), a floating action button on mobile. Two dropdown instances
 * (one per trigger) share the same items.
 */
export type AddMenuProps = {
  onAddEvent: () => void;
  onAddPayment: () => void;
  onAddBirthday: () => void;
};

export function AddMenu({ onAddEvent, onAddPayment, onAddBirthday }: AddMenuProps) {
  const renderItems = () => (
    <>
      <DropdownMenuItem onClick={onAddEvent}>
        <CalendarIcon className="size-4 text-blue-500 dark:text-blue-400" />
        Događaj
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onAddPayment}>
        <BanknotesIcon className="size-4 text-amber-500 dark:text-amber-400" />
        Plaćanje
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onAddBirthday}>
        <CakeIcon className="size-4 text-emerald-500 dark:text-emerald-400" />
        Rođendan
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      {/* Desktop: labelled header dropdown. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" className="hidden md:inline-flex">
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {renderItems()}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mobile: floating action button, clearing the bottom nav. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-lg"
            aria-label="Dodaj"
            className="fixed right-4 bottom-24 z-30 size-14 rounded-full shadow-lg md:hidden"
          >
            <PlusIcon className="size-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-48">
          {renderItems()}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
