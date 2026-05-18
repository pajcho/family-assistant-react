import { EllipsisVerticalIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import type { Birthday } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { BirthdayDisplayLine } from "@/components/birthdays/BirthdayDisplayLine";

/**
 * Single row inside the birthdays list. Direct port of
 * `components/birthdays/BirthdayListItem.vue`:
 *
 *   - On mobile (`< sm`) the actions collapse into a single 3-dot kebab that
 *     opens a dropdown. The Nuxt original uses a custom `<Dropdown>` wrapper —
 *     here we use shadcn's `DropdownMenu` directly with an icon Button trigger.
 *   - On desktop (`sm:` and up) the actions render as inline outline / destructive
 *     buttons (Izmeni, Obriši).
 *
 * The card chrome (border, padding, shadow) lives on the parent `<li>` in the
 * route file, matching how the Vue page wraps each item.
 */
export type BirthdayListItemProps = {
  birthday: Birthday;
  onEdit: (birthday: Birthday) => void;
  onDelete: (birthday: Birthday) => void;
};

export function BirthdayListItem({ birthday, onEdit, onDelete }: BirthdayListItemProps) {
  const hasDescription = !!birthday.description;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-3 sm:flex-nowrap",
        hasDescription ? "items-start" : "items-center",
      )}
    >
      <div className="min-w-0 flex-1">
        <BirthdayDisplayLine name={birthday.name} birthDate={birthday.birth_date} />
        {birthday.description && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{birthday.description}</p>
        )}
      </div>

      {/* Mobile: single kebab → dropdown. */}
      <div className="flex shrink-0 sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Akcije"
              className="text-gray-500 dark:text-gray-400"
            >
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(birthday)}>
              <PencilIcon className="h-4 w-4" />
              Izmeni
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(birthday)}>
              <TrashIcon className="h-4 w-4" />
              Obriši
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop: inline outline buttons. */}
      <div className="hidden shrink-0 gap-2 sm:flex">
        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(birthday)}>
          <PencilIcon className="mr-1 h-4 w-4" />
          Izmeni
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(birthday)}>
          <TrashIcon className="mr-1 h-4 w-4" />
          Obriši
        </Button>
      </div>
    </div>
  );
}
