import {
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The dashboard's "Dodaj" affordance — a menu over the four agenda types plus
 * a "Lista" shortcut (lists live on /lists, so that entry navigates there with
 * the create dialog open instead of opening a dialog in place). A labelled
 * header dropdown on desktop (lg+), a floating action button below lg (where
 * the bottom nav lives). Two dropdown instances (one per trigger) share the
 * same items.
 */
export type AddMenuProps = {
  onAddActivity: () => void;
  onAddEvent: () => void;
  onAddPayment: () => void;
  onAddBirthday: () => void;
  onAddList: () => void;
};

export function AddMenu({
  onAddActivity,
  onAddEvent,
  onAddPayment,
  onAddBirthday,
  onAddList,
}: AddMenuProps) {
  const renderItems = () => (
    <>
      <DropdownMenuItem onClick={onAddActivity}>
        <UserGroupIcon className="size-4 text-violet-500 dark:text-violet-400" />
        Aktivnost
      </DropdownMenuItem>
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
      <DropdownMenuItem onClick={onAddList}>
        <ClipboardDocumentListIcon className="size-4 text-purple-500 dark:text-purple-400" />
        Lista
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      {/* Desktop (lg+): labelled header dropdown. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" className="hidden lg:inline-flex">
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {renderItems()}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Below lg: floating action button, clearing the bottom nav. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-lg"
            aria-label="Dodaj"
            className="fixed right-4 bottom-24 z-30 size-14 rounded-full shadow-lg lg:hidden"
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
