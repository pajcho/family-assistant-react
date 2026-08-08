import { useState } from "react";

import type { AgendaItem } from "@/hooks/useAgenda";
import { agendaItemKey } from "@/hooks/useAgenda";
import {
  KidCard,
  KidCardMain,
  KidCardMeta,
  KidCardNote,
  KidCardSide,
  KidCardTime,
  KidCardTitle,
  KidGroupHeading,
  KidTag,
  KidTile,
} from "@/components/kid/KidUi";
import { KidDetailSheet } from "@/components/kid/KidSheet";
import { kidCardModel, kidDetailModel } from "@/components/kid/kidAgendaModel";
import { kidDayHeading } from "@/components/kid/kidCopy";

/**
 * One agenda card, and the sheet it opens.
 *
 * Read-only by construction: a tap opens details and nothing else. There is no
 * edit, no delete and no "+" anywhere in the kid shell, so the card's only job
 * is to be big, legible and obviously tappable.
 */

export function KidAgendaCard({
  item,
  todayISO,
  onOpen,
  birthdayNote,
}: {
  item: AgendaItem;
  todayISO: string;
  onOpen: (item: AgendaItem) => void;
  /** The parent's note for THIS child, shown instead of the generic meta. */
  birthdayNote?: string;
}) {
  const model = kidCardModel(item, { todayISO });
  const meta = birthdayNote ?? model.meta;
  // A strike-through is invisible to a screen reader, so the cancellation has
  // to be in the label as well as in the paint.
  const ariaLabel = model.canceled
    ? `${model.title} - otkazano - otvori detalje`
    : `${model.title} - otvori detalje`;

  return (
    <KidCard onClick={() => onOpen(item)} ariaLabel={ariaLabel} muted={model.canceled}>
      {/* The glyph fades rather than greys alone: a flat grayscale tile turns
          into the darkest thing on the screen in the Svemir theme. */}
      <KidTile emoji={model.emoji} className={model.canceled ? "opacity-55 grayscale" : ""} />
      <KidCardMain>
        <KidCardTitle struck={model.canceled}>{model.title}</KidCardTitle>
        {meta ? <KidCardMeta>{meta}</KidCardMeta> : null}
        {model.moved ? <KidCardNote>{model.moved}</KidCardNote> : null}
      </KidCardMain>
      <KidCardSide>
        {model.time ? <KidCardTime muted={model.canceled}>{model.time}</KidCardTime> : null}
        {model.tag ? (
          <KidTag tone={model.tag.tone}>{model.tag.label}</KidTag>
        ) : model.timeMeta ? (
          <span className="text-[11px] font-normal text-[var(--k-sub)]">{model.timeMeta}</span>
        ) : null}
      </KidCardSide>
    </KidCard>
  );
}

/**
 * A list of agenda cards, optionally grouped under day headings, wired to a
 * single detail sheet. One sheet for the whole list keeps focus handling in one
 * place and means the sheet is mounted only while something is open.
 */
export function KidAgendaList({
  items,
  todayISO,
  grouped = false,
  birthdayNotes,
}: {
  items: AgendaItem[];
  todayISO: string;
  /** Insert a heading whenever the day changes ("Sutra · utorak 6. okt"). */
  grouped?: boolean;
  birthdayNotes?: Map<string, string>;
}) {
  const [openItem, setOpenItem] = useState<AgendaItem | null>(null);
  const detail = openItem ? kidDetailModel(openItem, { todayISO }) : null;

  // A birthday's per-child note belongs in the sheet too - it is the whole
  // reason a parent ticked that child.
  const detailRows =
    detail && openItem?.kind === "birthday" && birthdayNotes?.get(openItem.birthday.id)
      ? [
          ...detail.rows,
          { icon: "💌", text: `Za tebe: ${birthdayNotes.get(openItem.birthday.id) as string}` },
        ]
      : (detail?.rows ?? []);

  let lastDate = "";

  return (
    <>
      {items.map((item) => {
        const showHeading = grouped && item.date !== lastDate;
        if (showHeading) lastDate = item.date;
        const heading = showHeading ? kidDayHeading(item.date, todayISO) : null;
        const note = item.kind === "birthday" ? birthdayNotes?.get(item.birthday.id) : undefined;
        return (
          <div key={agendaItemKey(item)}>
            {heading ? <KidGroupHeading title={heading.title} chip={heading.chip} /> : null}
            <KidAgendaCard
              item={item}
              todayISO={todayISO}
              onOpen={setOpenItem}
              birthdayNote={note}
            />
          </div>
        );
      })}

      {detail ? (
        <KidDetailSheet
          open
          onClose={() => setOpenItem(null)}
          emoji={detail.emoji}
          title={detail.title}
          rows={detailRows}
        />
      ) : null}
    </>
  );
}
