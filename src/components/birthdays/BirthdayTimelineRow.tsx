import { CakeIcon, SparklesIcon } from "@heroicons/react/24/outline";

import {
  ItemCard,
  ItemMain,
  ItemMeta,
  ItemSide,
  ItemTile,
  ItemTitle,
} from "@/components/common/ItemCard";
import { Pill } from "@/components/common/Pill";
import type { Birthday, Event } from "@/types/database";
import { currentAge, daysUntilBirthday } from "@/utils/birthday";
import { formatDate } from "@/utils/date";

/**
 * Tappable row in the /birthdays list - the shared `.kcard`. Name plus a
 * "Proslava" pill when a celebration event is linked, the date and the age
 * they are turning in the meta line, and the countdown on the right.
 *
 * Every action lives in the detail popup the tap opens.
 */

/**
 * "za N dana" pluralization, carried over verbatim: 0 → "danas",
 * 1 → "sutra", everything else → `za N dana` (no dan/dana branching).
 */
function daysLabel(days: number): string {
  if (days === 0) return "danas";
  if (days === 1) return "sutra";
  return `za ${days} dana`;
}

export function BirthdayTimelineRow({
  birthday,
  celebration,
  onSelect,
}: {
  birthday: Birthday;
  /** The linked celebration event, if one has been organized. */
  celebration: Event | null;
  onSelect: (birthday: Birthday) => void;
}) {
  const nextAge = currentAge(birthday.birth_date) + 1;
  const days = daysUntilBirthday(birthday.birth_date);
  const meta = [
    birthday.description?.trim() || null,
    formatDate(birthday.birth_date),
    `puni ${nextAge}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ItemCard onClick={() => onSelect(birthday)}>
      <ItemTile icon={CakeIcon} tone="accent" />
      <ItemMain>
        <ItemTitle>
          <span className="min-w-0 truncate">{birthday.name}</span>
          {celebration ? (
            <Pill>
              <SparklesIcon className="size-2.5" aria-hidden="true" />
              Proslava
            </Pill>
          ) : null}
        </ItemTitle>
        <ItemMeta>
          <span className="min-w-0 truncate">{meta}</span>
        </ItemMeta>
      </ItemMain>
      <ItemSide>
        {/* The countdown carries the urgency: green once it is within the
            week the family would actually be preparing for it. */}
        <Pill tone={days <= 7 ? "pos" : "muted"}>{daysLabel(days)}</Pill>
      </ItemSide>
    </ItemCard>
  );
}
