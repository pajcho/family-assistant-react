import type { ComponentType, SVGProps } from "react";
import {
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  GlobeAltIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

import type { ItemTileTone } from "@/components/common/ItemCard";
import { fallbackColorForProfile } from "@/utils/activity";
import type { AgendaItem } from "@/hooks/useAgenda";
import type { AgendaKind } from "@/utils/agendaFilters";

/**
 * One place deciding what each agenda kind LOOKS like - the glyph, the tile
 * tone and the dot colour. The agenda rows, the filter chips and the month
 * grid's density dots all read from here, so a payment is amber and a Google
 * event is blue on every surface at once.
 *
 * Tones come from the semantics layer (pos/warn/neg/info), never from the
 * accent, so they survive the user switching the app colour. The exception
 * is activities, which are coloured by the family member they belong to - the
 * app's oldest colour convention.
 */

export type AgendaKindMeta = {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: ItemTileTone;
  /** CSS colour for the month grid's density dots. */
  dot: string;
};

export const AGENDA_KIND_META: Record<AgendaKind, AgendaKindMeta> = {
  activity: { label: "Aktivnosti", icon: SparklesIcon, tone: "accent", dot: "var(--accent)" },
  event: { label: "Događaji", icon: CalendarIcon, tone: "info", dot: "var(--info)" },
  external: { label: "Google", icon: GlobeAltIcon, tone: "info", dot: "var(--info)" },
  payment: { label: "Plaćanja", icon: BanknotesIcon, tone: "warn", dot: "var(--warn)" },
  birthday: { label: "Rođendani", icon: CakeIcon, tone: "pos", dot: "var(--pos)" },
};

/**
 * The colour an item contributes to a month cell's dots. Activities (and only
 * activities) resolve to their person's colour; everything else uses its kind
 * colour, with a mirrored Google calendar's own colour taking precedence.
 */
export function agendaItemDotColor(item: AgendaItem): string {
  if (item.kind === "activity") {
    return item.person?.color ?? fallbackColorForProfile(item.block.personId);
  }
  if (item.kind === "external" && item.event.color) return item.event.color;
  return AGENDA_KIND_META[item.kind].dot;
}
