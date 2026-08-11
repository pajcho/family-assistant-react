import { useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import {
  ArrowUpIcon,
  ArrowPathIcon,
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
  useTaskAssigneeSummary,
} from "@/components/tasks/TaskFields";
import {
  emptyTaskDraft,
  taskDateSummary,
  taskDraftToCreateInput,
  taskRecurrenceSummary,
  taskReminderSummary,
  type TaskDraft,
} from "@/components/tasks/taskDraft";
import { useCreateTask } from "@/hooks/useTasks";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useToday } from "@/hooks/useToday";
import { cn } from "@/lib/cn";
import { srLocale } from "@/utils/date";
import { shiftIsoByDays } from "@/utils/pickerGrid";

/**
 * The one field a new task starts as, and the row of shortcuts that appears the
 * moment you type into it.
 *
 * It replaces the add-input that used to sit ABOVE the rows, at the far end of
 * the screen from the thumb, and it stays a single field until there is
 * something to schedule: below `lg` it is pinned to the bottom of the page, at
 * `lg` and up it follows the last row, which is where the pointer already is.
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
  /** Pre-set fields for a screen that already implies them (a dated smart list). */
  initialDraft?: Partial<TaskDraft>;
  placeholder?: string;
  /**
   * Bottom-pinned (phones) or inline after the last row (`lg` and up). One
   * component, one breakpoint class - see decision 11 of the plan.
   */
  variant?: "pinned" | "inline";
};

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
  initialDraft,
  placeholder = "Dodaj zadatak…",
  variant = "pinned",
}: TaskComposerProps) {
  const today = useToday().str;
  const tomorrow = shiftIsoByDays(today, 1) ?? today;
  const createTask = useCreateTask();

  const [draft, setDraft] = useState<TaskDraft>(() => emptyTaskDraft(initialDraft));
  const [picker, setPicker] = useState<ComposerPicker | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardInset = useKeyboardInset();
  // Just the state. Handing the field back is `onCloseAutoFocus`'s job down in
  // ComposerPickerSheets - doing it here too raced with the dialog's own focus
  // restore and the field lost either way.
  const closePicker = () => setPicker(null);

  const typed = draft.name.trim().length > 0;
  const assigneeSummary = useTaskAssigneeSummary(draft);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!typed) return;
    createTask.mutate(taskDraftToCreateInput(draft, listId));
    // Back to the resting state after every add: a composer that silently keeps
    // last time's recurrence is how somebody ends up with a daily "Mleko".
    setDraft(emptyTaskDraft(initialDraft));
  };

  const nextWeekdayIso = nextWeekdayFrom(today);

  // The Datum chip is the escape hatch, so it keeps its label while one of the
  // three one-tap days is what is set - two chips both reading "Danas" says
  // nothing twice. It takes over the read-back the moment the date is something
  // they cannot express, or a time is on it.
  const quickDates = new Set([today, tomorrow, nextWeekdayIso]);
  const dateIsBeyondChips =
    draft.dueDate !== null && (!quickDates.has(draft.dueDate) || draft.dueTime !== null);

  return (
    <div
      className={cn(
        variant === "pinned"
          ? // Bleeds to the page edges so the bar reads as chrome rather than a
            // card, and sits flush with the bottom of the scroll area. `mt-auto`
            // is what holds it there on a SHORT list (the screen shell makes the
            // column at least a scrollport tall for exactly this); sticky is what
            // holds it there on a long one. Opaque (no backdrop-filter): a
            // translucent sticky bar is one of the two things iOS refuses to
            // repaint reliably while scrolling.
            //
            // `bottom` is driven by the measured keyboard inset, not left at 0.
            // Safari does not shrink the layout viewport for the keyboard (see
            // useKeyboardInset), so `bottom: 0` pins this bar to a page edge that
            // is itself behind the keyboard, and iOS then pans the page to chase
            // the focused field - which is what left a band of empty page on one
            // side of the composer or the other. Pinned `inset` px up instead, the
            // bar sits ON the keyboard, the tasks keep flowing right up to it, and
            // nothing has to be panned at all.
            cn(
              "sticky -mx-4 border-t border-border bg-background px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] lg:static lg:mx-0 lg:mt-3 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0",
              "mt-auto",
            )
          : "mt-3",
      )}
      style={variant === "pinned" ? { bottom: keyboardInset } : undefined}
    >
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft.name}
          onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 flex-1"
          // No scrollIntoView here on purpose. It used to drag the whole page up
          // to rescue a field the keyboard covered; `interactive-widget=
          // resizes-content` (index.html) now shrinks the layout viewport
          // instead, so the bar arrives above the keyboard on its own and the
          // tasks stay where the reader left them.
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <button
          type="submit"
          disabled={!typed}
          aria-label="Dodaj zadatak"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground transition-transform active:scale-[0.94] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:active:scale-100"
        >
          <ArrowUpIcon className="size-[18px]" strokeWidth={2.4} />
        </button>
      </form>

      {/* On FOCUS, not on the first keystroke. Waiting for a character meant the
          row appeared one beat after the keyboard and shoved the field up again -
          two shifts for one intention. `picker` keeps the row up while a sheet is
          open, when the field is necessarily blurred. */}
      {focused || typed || picker !== null ? (
        <div
          role="group"
          aria-label="Detalji zadatka"
          className="scrollbar-hide fade-scroll-x mt-2 flex min-h-11 items-center gap-1.5 overflow-x-auto"
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
            onClick={() => setPicker("date")}
          >
            Datum
          </QuickChip>
          <QuickChip
            icon={<UserIcon className="size-3.5" aria-hidden="true" />}
            active={draft.assigneeIds.length > 0}
            summary={assigneeSummary}
            onClick={() => setPicker("who")}
          >
            Za koga
          </QuickChip>
          <QuickChip
            icon={<ArrowPathIcon className="size-3.5" aria-hidden="true" />}
            active={draft.recurrencePeriod !== "one-time"}
            summary={taskRecurrenceSummary(draft)}
            onClick={() => setPicker("recurrence")}
          >
            Ponavljanje
          </QuickChip>
          <QuickChip
            icon={<BellIcon className="size-3.5" aria-hidden="true" />}
            active={draft.remindDaysBefore !== null || draft.remindMinutesBefore !== null}
            summary={taskReminderSummary(draft)}
            onClick={() => setPicker("reminder")}
          >
            Podsetnik
          </QuickChip>
        </div>
      ) : null}

      <ComposerPickerSheets
        picker={picker}
        onClose={closePicker}
        refocusInput={() => inputRef.current?.focus()}
        draft={draft}
        setDraft={setDraft}
      />
    </div>
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
}: {
  picker: ComposerPicker | null;
  onClose: () => void;
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
  /** Hands the field back when the sheet closes - see `onCloseAutoFocus`. */
  refocusInput: () => void;
}) {
  const stack = useSheetStack<ComposerPicker>(picker !== null, onClose, picker ?? "date");

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent
          className="sm:max-w-md"
          // A dialog restores focus to whatever opened it, which here is a chip -
          // so the keyboard stayed down and the composer collapsed the moment you
          // finished picking a date. Take the restore over: focus goes back to
          // the field, inside the same gesture that dismissed the sheet, which is
          // the only timing from which iOS will bring the keyboard back up.
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
          {view === "who" ? <TaskWhoSheetBody draft={draft} setDraft={setDraft} /> : null}
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
