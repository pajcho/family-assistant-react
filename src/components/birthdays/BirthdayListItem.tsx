import {
  CakeIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import type { Birthday, Event } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { BirthdayDisplayLine } from "@/components/birthdays/BirthdayDisplayLine";
import { formatDate } from "@/utils/date";

/**
 * Single row inside the birthdays list.
 *
 *   - On mobile (`< sm`) the actions collapse into a single 3-dot kebab that
 *     opens a dropdown (Organizuj proslavu / Izmeni / Obriši).
 *   - On desktop (`sm:` and up) the actions render as inline buttons.
 *   - When an upcoming celebration event is linked to this birthday
 *     (`events.birthday_id`), a tappable "Proslava · <datum>" chip shows under
 *     the description and opens that event's edit form; the organize action
 *     hides (one upcoming celebration per birthday is the expected shape).
 *
 * The card chrome (border, padding, shadow) lives on the parent `<li>` in the
 * route file.
 */
export type BirthdayListItemProps = {
  birthday: Birthday;
  /** Soonest upcoming celebration event linked to this birthday, if any. */
  celebration?: Event | null;
  onEdit: (birthday: Birthday) => void;
  onDelete: (birthday: Birthday) => void;
  onOrganize: (birthday: Birthday) => void;
  onOpenCelebration: (event: Event) => void;
};

export function BirthdayListItem({
  birthday,
  celebration,
  onEdit,
  onDelete,
  onOrganize,
  onOpenCelebration,
}: BirthdayListItemProps) {
  const hasDescription = !!birthday.description;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-3 sm:flex-nowrap",
        hasDescription || celebration ? "items-start" : "items-center",
      )}
    >
      <div className="min-w-0 flex-1">
        <BirthdayDisplayLine name={birthday.name} birthDate={birthday.birth_date} />
        {birthday.description && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{birthday.description}</p>
        )}
        {celebration ? (
          <button
            type="button"
            onClick={() => onOpenCelebration(celebration)}
            className="mt-1.5 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium text-pink-700 transition-colors hover:bg-pink-100 dark:bg-pink-900/30 dark:text-pink-300 dark:hover:bg-pink-900/50"
          >
            <SparklesIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {celebration.name} · {formatDate(celebration.date)}
            </span>
          </button>
        ) : null}
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
            {!celebration ? (
              <>
                <DropdownMenuItem onSelect={() => onOrganize(birthday)}>
                  <CakeIcon className="h-4 w-4" />
                  Organizuj proslavu
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
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

      {/* Desktop: inline buttons. */}
      <div className="hidden shrink-0 gap-2 sm:flex">
        {!celebration ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onOrganize(birthday)}>
            <CakeIcon className="mr-1 h-4 w-4" />
            Organizuj proslavu
          </Button>
        ) : null}
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
