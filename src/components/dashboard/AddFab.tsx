import { BanknotesIcon, CakeIcon, CalendarIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Floating "Dodaj" button for the agenda dashboard. Replaces the per-card add
 * buttons of the old grid with a single menu → Događaj / Plaćanje / Rođendan,
 * wired straight to the dashboard's existing `openAdd*` handlers. Sits above
 * the mobile bottom nav (which is `fixed bottom-0 … md:hidden`) and tucks into
 * the corner on desktop.
 */
export type AddFabProps = {
  onAddEvent: () => void;
  onAddPayment: () => void;
  onAddBirthday: () => void;
};

export function AddFab({ onAddEvent, onAddPayment, onAddBirthday }: AddFabProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-lg"
          aria-label="Dodaj"
          className="fixed right-4 bottom-24 z-30 size-14 rounded-full shadow-lg md:right-6 md:bottom-6"
        >
          <PlusIcon className="size-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-48">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
