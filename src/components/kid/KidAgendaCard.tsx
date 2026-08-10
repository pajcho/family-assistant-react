import { useState } from "react";

import type { AgendaItem } from "@/hooks/useAgenda";
import { agendaItemKey } from "@/hooks/useAgenda";
import type { UseKidTasksResult } from "@/hooks/useKidTasks";
import {
  KidCard,
  KidCardMain,
  KidCardMeta,
  KidCardNote,
  KidCardSide,
  KidCardTime,
  KidCardTitle,
  KidCheckCircle,
  KidCheckableCard,
  KidGroupHeading,
  KidTag,
  KidTile,
} from "@/components/kid/KidUi";
import { KidDetailSheet } from "@/components/kid/KidSheet";
import type { KidCardModel } from "@/components/kid/kidAgendaModel";
import { kidCardModel, kidDetailModel } from "@/components/kid/kidAgendaModel";
import { kidDayHeading } from "@/components/kid/kidCopy";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * One agenda card, and the sheet it opens.
 *
 * Read-only apart from ONE thing: a chore's tick circle. Everything else a child
 * sees is news from a grown-up, so a tap opens details and nothing more - there
 * is no edit, no delete and no "+" anywhere in the kid shell.
 */

/**
 * A chore: the same card as its neighbours, with a tick circle where they carry
 * their glyph tile. The circle takes that slot rather than sitting beside the
 * tile on purpose - it keeps the shell's rhythm (one 46px leading square, body,
 * right-hand column), leaves a chore's name exactly as much room as an
 * activity's, and the swap from glyph to circle is itself the signal that says
 * "this one is yours to do". The glyph is not lost; it opens the sheet.
 */
function KidChoreCard({
  model,
  canComplete,
  onOpen,
  onToggle,
}: {
  model: KidCardModel;
  /** False for a chore that has not happened yet, and in the parent preview. */
  canComplete: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  // Strike-through and a filled circle are both invisible to a screen reader, so
  // "done" has to be in the label as well as in the paint.
  const openLabel = model.done
    ? `${model.title} - završeno - otvori detalje`
    : `${model.title} - otvori detalje`;
  const body = (
    <>
      <KidCardMain>
        <KidCardTitle struck={model.done}>{model.title}</KidCardTitle>
        {model.meta ? <KidCardMeta>{model.meta}</KidCardMeta> : null}
      </KidCardMain>
      <KidCardSide>
        {model.time ? <KidCardTime muted={model.done}>{model.time}</KidCardTime> : null}
        {model.tag ? <KidTag tone={model.tag.tone}>{model.tag.label}</KidTag> : null}
      </KidCardSide>
    </>
  );

  // Out of reach: one plain card button, with the circle as an inert marker
  // inside it. A tap anywhere - the circle included - opens the details, which
  // is where the child reads WHEN the chore is for. Nothing to press in vain.
  if (!canComplete) {
    return (
      <KidCard onClick={onOpen} ariaLabel={openLabel}>
        <KidCheckCircle done={model.done} />
        {body}
      </KidCard>
    );
  }

  return (
    <KidCheckableCard
      circle={
        <KidCheckCircle
          done={model.done}
          onToggle={onToggle}
          ariaLabel={
            model.done
              ? `Vrati zadatak "${model.title}" na nezavršeno`
              : `Završi zadatak "${model.title}"`
          }
        />
      }
      onOpen={onOpen}
      ariaLabel={openLabel}
    >
      {body}
    </KidCheckableCard>
  );
}

function KidAgendaCard({
  item,
  todayISO,
  onOpen,
  birthdayNote,
  tasks,
}: {
  item: AgendaItem;
  todayISO: string;
  onOpen: (item: AgendaItem) => void;
  /** The parent's note for THIS child, shown instead of the generic meta. */
  birthdayNote?: string;
  /** Chore state + the tick. Omitted on a screen that shows no chores. */
  tasks?: UseKidTasksResult;
}) {
  const model = kidCardModel(item, { todayISO, taskDone: tasks?.isDone });

  if (item.kind === "task") {
    const chore = tasks?.byKey.get(taskOccurrenceKey(item.task.id, item.occurrenceDate));
    return (
      <KidChoreCard
        model={model}
        canComplete={chore?.canComplete ?? false}
        onOpen={() => onOpen(item)}
        onToggle={() =>
          // The SERIES date, never the effective one: that is what an occurrence
          // row keys on, and what `kid_complete_task` expects.
          tasks?.completeTask({
            task: item.task,
            date: item.occurrenceDate,
            done: !model.done,
          })
        }
      />
    );
  }

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
  tasks,
}: {
  items: AgendaItem[];
  todayISO: string;
  /** Insert a heading whenever the day changes ("Sutra · utorak 6. okt"). */
  grouped?: boolean;
  birthdayNotes?: Map<string, string>;
  /**
   * Chore state + the tick, from one `useKidTasks` mounted by the screen. The
   * screen owns it, not this list: one mutation observer per screen rather than
   * one per card.
   */
  tasks?: UseKidTasksResult;
}) {
  const [openItem, setOpenItem] = useState<AgendaItem | null>(null);
  const detail = openItem ? kidDetailModel(openItem, { todayISO, taskDone: tasks?.isDone }) : null;

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
              tasks={tasks}
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
