import { useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import {
  ArrowUpIcon,
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  BellIcon,
  CalendarDaysIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { format, parseISO } from "date-fns";

import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  TaskDateSheetBody,
  TaskRecurrenceSheetBody,
  TaskReminderSheetBody,
  TaskWhoSheetBody,
  useSelfAssignWhenPrivate,
  useTaskAssigneeSummary,
} from "@/components/tasks/TaskFields";
import { TaskQuickAddFlow } from "@/components/tasks/TaskQuickAddFlow";
import {
  emptyTaskDraft,
  privateDraftDefaults,
  taskDateSummary,
  taskDraftToCreateInput,
  taskRecurrenceSummary,
  taskReminderSummary,
  type TaskDraft,
} from "@/components/tasks/taskDraft";
import { useProfile } from "@/hooks/useProfile";
import { useCreateTask } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { cn } from "@/lib/cn";
import { srLocale } from "@/utils/date";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import type { ListScope } from "@/types/database";

/**
 * The one field a new task starts as, and the row of shortcuts that appears the
 * moment you touch it.
 *
 * It sits in the flow, straight after the last row, on every screen size - the
 * end of the list is where a new item belongs. Nothing pins it, nothing lifts
 * it, and nothing measures the keyboard: the browser scrolls a focused field
 * into view by itself, and letting it do that is the whole design.
 *
 * The quick row splits the seven affordances by cost. Danas / Sutra / the next
 * weekday set `due_date` in place - one tap, no overlay, because "tomorrow" is
 * what most reminders are. The other four open a sheet each: they need a real
 * control, and growing the composer into a form is exactly what a composer must
 * not do. Nothing on the row is required, so an undated item is still
 * type-and-send - which is the only way a shopping list works.
 */

export type TaskComposerProps = {
  /** Where the task lands. Null = a standalone task, which the Inbox catches. */
  listId: string | null;
  /**
   * Visibility of that list, so the "Samo ja" switch inside "Za koga" can say
   * what the list already decided. Irrelevant (and ignored) when `listId` is
   * null, where the task answers for itself.
   */
  listScope?: ListScope | null;
  /** Pre-set fields for a screen that already implies them (a dated smart list). */
  initialDraft?: Partial<TaskDraft>;
  placeholder?: string;
};

/**
 * The draft this composer rests on. Outside a list that is private-by-default
 * (see `privateDraftDefaults`); the screen's own pre-sets win over it, since a
 * screen that says "these are mine" or "this is for today" means it.
 */
function composerDraft(
  listId: string | null,
  viewerId: string | null,
  initialDraft?: Partial<TaskDraft>,
): TaskDraft {
  return emptyTaskDraft({
    ...(listId === null ? privateDraftDefaults(viewerId) : undefined),
    ...initialDraft,
  });
}

/** Which picker is open. `null` = just the field and its chips. */
type ComposerPicker = "date" | "who" | "recurrence" | "reminder";

const PICKER_TITLE: Record<ComposerPicker, string> = {
  date: "Datum",
  who: "Za koga",
  recurrence: "Ponavljanje",
  reminder: "Podsetnik",
};

export function TaskComposer({
  listId,
  listScope = null,
  initialDraft,
  placeholder = "Dodaj zadatak…",
}: TaskComposerProps) {
  const today = useToday().str;
  const tomorrow = shiftIsoByDays(today, 1) ?? today;
  const createTask = useCreateTask();
  const viewerId = useProfile().profile?.id ?? null;

  const [draft, setDraft] = useState<TaskDraft>(() =>
    composerDraft(listId, viewerId, initialDraft),
  );
  // This mounts with its screen, so on a cold start straight to /tasks/inbox the
  // profile query is still in flight and the private default has no id to point
  // at yet. See the hook.
  useSelfAssignWhenPrivate(setDraft);
  const [picker, setPicker] = useState<ComposerPicker | null>(null);
  const [focused, setFocused] = useState(false);
  // The full form, opened by the expand button. Mounted on first use only: it
  // loads the list of lists, and a screen whose composer is never touched has no
  // business asking for them. `handover` is the draft it was opened with, held
  // separately because by then this composer has already let go of it.
  const [fullFormOpen, setFullFormOpen] = useState(false);
  const [fullFormMounted, setFullFormMounted] = useState(false);
  const [handover, setHandover] = useState<TaskDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Just the state. Where the focus lands afterwards is `onCloseAutoFocus`'s
  // call down in ComposerPickerSheets - doing it here too raced with the
  // dialog's own focus restore and the field lost either way.
  const closePicker = () => setPicker(null);

  const typed = draft.name.trim().length > 0;
  const assigneeSummary = useTaskAssigneeSummary(draft);

  // "The chips are out". It outlives the focus on purpose: a draft with
  // anything in it - a name, or just a date picked from a sheet - keeps its
  // schedule row, so a task carries its read-backs until it is sent. Reading
  // the whole draft rather than only the text is what stops a date you just
  // chose from disappearing along with the chips when its sheet closes.
  const expanded = focused || typed || draftHasDetail(draft) || picker !== null || fullFormOpen;

  // The four chips that open a sheet LEAVE the field, so they give up its focus
  // and the keyboard goes down before the sheet arrives. The three day chips
  // deliberately do not (see QuickChip): they modify what you are typing, and
  // tearing the keyboard down to set "Sutra" would be absurd.
  const openPicker = (next: ComposerPicker) => {
    inputRef.current?.blur();
    setPicker(next);
  };

  // A HANDOVER, not a copy: the draft moves into the full form and this line is
  // cleared on the spot. The task exists in one place at a time, so backing out
  // of the form leaves an empty composer rather than a stale duplicate of what
  // you just abandoned - and saving from in there needs no tidying up here.
  const openFullForm = () => {
    inputRef.current?.blur();
    setHandover(draft);
    setDraft(composerDraft(listId, viewerId, initialDraft));
    setFullFormMounted(true);
    setFullFormOpen(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!typed) return;
    createTask.mutate(taskDraftToCreateInput(draft, listId));
    // Back to the resting state after every add: a composer that silently keeps
    // last time's recurrence is how somebody ends up with a daily "Mleko".
    setDraft(composerDraft(listId, viewerId, initialDraft));
  };

  const nextWeekdayIso = nextWeekdayFrom(today);

  // The Datum chip is the escape hatch, so it keeps its label while one of the
  // three one-tap days is what is set - two chips both reading "Danas" says
  // nothing twice. It takes over the read-back the moment the date is something
  // they cannot express, or a time is on it.
  const quickDates = new Set([today, tomorrow, nextWeekdayIso]);
  const dateIsBeyondChips =
    draft.dueDate !== null && (!quickDates.has(draft.dueDate) || draft.dueTime !== null);

  // Input and chips inside ONE frame, so it reads as a single thing being
  // filled in rather than a field with a toolbar that happens to sit under it.
  // The frame only exists while it has both halves to hold together: collapsed,
  // the field's own border is the outline; expanded, the field goes borderless
  // and the frame takes over.
  const unit = (
    <div
      className={cn(
        "rounded-2xl transition-[padding,background-color] duration-150",
        expanded && "border border-border bg-card p-1.5 shadow-card",
      )}
    >
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft.name}
          onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
          placeholder={placeholder}
          aria-label={placeholder}
          // Enter adds the task and leaves the field focused, so several items
          // can be typed in one go - that is implicit form submission doing the
          // work, and it only happens while the submit button is enabled. The
          // hint is here because without it iOS labels the key with a plain
          // return arrow, which reads as "new line", not "add".
          enterKeyHint="send"
          className={cn(
            "h-10 flex-1",
            expanded && "border-transparent bg-transparent shadow-none focus-visible:ring-0",
          )}
          // Nothing here asks the page to move. The browser scrolls a focused
          // field into view on its own, and every attempt to help it along -
          // scrollIntoView, a measured keyboard inset, a lifted overlay - has
          // been worse than letting it happen.
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {/* The way out of a one-line composer: everything typed so far moves
            into the full form, where the fields are laid out instead of hidden
            behind four sub-views. Only while the composer is in use - at rest it
            would be a second "add" button next to the "+" in the nav. */}
        {expanded ? (
          <button
            type="button"
            aria-label="Otvori punu formu"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openFullForm}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowsPointingOutIcon className="size-[18px]" strokeWidth={2} />
          </button>
        ) : null}
        <button
          type="submit"
          disabled={!typed}
          aria-label="Dodaj zadatak"
          // Same reason as the chips: adding one task must not tear the keyboard
          // down, because the next one is usually right behind it.
          onMouseDown={(event) => event.preventDefault()}
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground transition-transform active:scale-[0.94] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:active:scale-100"
        >
          <ArrowUpIcon className="size-[18px]" strokeWidth={2.4} />
        </button>
      </form>

      {/* On FOCUS, not on the first keystroke. Waiting for a character meant the
          row appeared one beat after the keyboard and shoved the field up again -
          two shifts for one intention. `typed` is what keeps it out once the
          keyboard is gone, and `picker` while a sheet has the focus. */}
      {expanded ? (
        <div
          role="group"
          aria-label="Detalji zadatka"
          className="scrollbar-hide fade-scroll-x mt-1.5 flex min-h-11 items-center gap-1.5 overflow-x-auto px-0.5"
        >
          <QuickChip
            active={draft.dueDate === today}
            onClick={() => setDraft((s) => ({ ...s, dueDate: s.dueDate === today ? null : today }))}
          >
            Danas
          </QuickChip>
          <QuickChip
            active={draft.dueDate === tomorrow}
            onClick={() =>
              setDraft((s) => ({ ...s, dueDate: s.dueDate === tomorrow ? null : tomorrow }))
            }
          >
            Sutra
          </QuickChip>
          <QuickChip
            active={draft.dueDate === nextWeekdayIso}
            onClick={() =>
              setDraft((s) => ({
                ...s,
                dueDate: s.dueDate === nextWeekdayIso ? null : nextWeekdayIso,
              }))
            }
          >
            {weekdayChipLabel(nextWeekdayIso)}
          </QuickChip>
          <QuickChip
            icon={<CalendarDaysIcon className="size-3.5" aria-hidden="true" />}
            active={dateIsBeyondChips}
            summary={dateIsBeyondChips ? taskDateSummary(draft, today, tomorrow) : null}
            onClick={() => openPicker("date")}
          >
            Datum
          </QuickChip>
          <QuickChip
            icon={<UserIcon className="size-3.5" aria-hidden="true" />}
            // Private counts as set even before the self-assignment lands - the
            // chip already reads "Samo ja", and reading it in the resting style
            // would say the opposite of what it says.
            active={draft.onlyMe || draft.assigneeIds.length > 0}
            summary={assigneeSummary}
            onClick={() => openPicker("who")}
          >
            Za koga
          </QuickChip>
          <QuickChip
            icon={<ArrowPathIcon className="size-3.5" aria-hidden="true" />}
            active={draft.recurrencePeriod !== "one-time"}
            summary={taskRecurrenceSummary(draft)}
            onClick={() => openPicker("recurrence")}
          >
            Ponavljanje
          </QuickChip>
          <QuickChip
            icon={<BellIcon className="size-3.5" aria-hidden="true" />}
            active={draft.remindDaysBefore !== null || draft.remindMinutesBefore !== null}
            summary={taskReminderSummary(draft)}
            onClick={() => openPicker("reminder")}
          >
            Podsetnik
          </QuickChip>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mt-3">
      {unit}
      <ComposerPickerSheets
        picker={picker}
        onClose={closePicker}
        refocusInput={() => inputRef.current?.focus()}
        draft={draft}
        setDraft={setDraft}
        listScope={listScope}
      />
      {fullFormMounted ? (
        <TaskQuickAddFlow
          open={fullFormOpen}
          onOpenChange={setFullFormOpen}
          initialDraft={handover ?? undefined}
          initialListId={listId}
        />
      ) : null}
    </div>
  );
}

/**
 * Whether anything has been set on the draft besides its name - which is what
 * keeps the chip row open (and its read-backs visible) after a picker closes on
 * a task that has not been typed yet.
 */
function draftHasDetail(draft: TaskDraft): boolean {
  return (
    draft.dueDate !== null ||
    draft.dueTime !== null ||
    // While "Samo ja" is on, the self-assignment came WITH it rather than from
    // a choice, so it is the resting state of a listless composer and must not
    // hold the chip row open the way a hand-picked assignee does.
    (!draft.onlyMe && draft.assigneeIds.length > 0) ||
    draft.recurrencePeriod !== "one-time" ||
    draft.remindDaysBefore !== null ||
    draft.remindMinutesBefore !== null
  );
}

/**
 * The four pickers as real overlays, one stack.
 *
 * Each opens as its own level so a dismissal (swipe down, Escape, tap outside)
 * and the "←" both put you back in the composer with everything you typed still
 * there. They commit as they are tapped - there is no Sačuvaj, because the
 * composer's own send button is the commit.
 */
function ComposerPickerSheets({
  picker,
  onClose,
  draft,
  setDraft,
  refocusInput,
  listScope,
}: {
  picker: ComposerPicker | null;
  onClose: () => void;
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
  /** Hands the field back when the sheet closes - see `onCloseAutoFocus`. */
  refocusInput: () => void;
  listScope: ListScope | null;
}) {
  const stack = useSheetStack<ComposerPicker>(picker !== null, onClose, picker ?? "date");

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent
          className="sm:max-w-md"
          // A dialog restores focus to whatever opened it, which here is a chip.
          // Hand it to the field instead: answering "which date" leaves you back
          // in the composer, on the same line you were writing.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            refocusInput();
          }}
        >
          <SheetStackHeader
            title={PICKER_TITLE[view]}
            onBack={() => stack.dismiss(level)}
            backAriaLabel="Nazad na unos"
          />
          {view === "date" ? <TaskDateSheetBody draft={draft} setDraft={setDraft} /> : null}
          {view === "who" ? (
            <TaskWhoSheetBody draft={draft} setDraft={setDraft} listScope={listScope} />
          ) : null}
          {view === "recurrence" ? (
            <TaskRecurrenceSheetBody draft={draft} setDraft={setDraft} />
          ) : null}
          {view === "reminder" ? <TaskReminderSheetBody draft={draft} setDraft={setDraft} /> : null}
        </ResponsiveDialogContent>
      )}
    />
  );
}

function QuickChip({
  active,
  icon,
  summary,
  onClick,
  children,
}: {
  active: boolean;
  icon?: ReactNode;
  /** Read-back of what is set, e.g. "Svaki dan" beside "Ponavljanje". */
  summary?: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Do NOT take focus off the field. A chip is a modifier on what you are
      // typing, not a destination: without this, every tap blurred the input,
      // iOS tore the keyboard down, and the page jumped by a third of the
      // screen - then jumped back when you carried on typing. preventDefault on
      // mousedown is what suppresses the focus change (iOS synthesises mousedown
      // for a tap), and the click still fires, so the chip still toggles.
      onMouseDown={(event) => event.preventDefault()}
      aria-pressed={active}
      className={cn(
        "relative flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5",
        "text-[12.5px] font-semibold whitespace-nowrap transition-colors",
        // Transparent bleed so the visible pill stays ~32px while the finger
        // target reaches the row's full 44px.
        "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "border-accent bg-accent-soft text-accent-deep"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {summary ?? children}
    </button>
  );
}

/**
 * The third one-tap day: the start of the next working week. It never collides
 * with the Sutra chip - on a Sunday, when tomorrow already IS Monday, it steps to
 * the Monday after, so the three chips always offer three different days.
 */
function nextWeekdayFrom(today: string): string {
  const dow = (parseISO(`${today}T12:00:00`).getDay() + 6) % 7; // 0 = Monday
  let delta = (7 - dow) % 7 || 7;
  if (delta <= 1) delta += 7;
  return shiftIsoByDays(today, delta) ?? today;
}

/** "Pon" - the weekday of a one-tap chip. */
function weekdayChipLabel(iso: string): string {
  const label = format(parseISO(`${iso}T12:00:00`), "EEE", { locale: srLocale });
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}
