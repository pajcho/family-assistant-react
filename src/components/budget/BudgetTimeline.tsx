import { useMemo } from "react";
import { format } from "date-fns";
import {
  CakeIcon,
  CalendarIcon,
  ChevronRightIcon,
  LockClosedIcon,
  PencilSquareIcon,
  ReceiptPercentIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { MemberBadges } from "@/components/common/MemberBadges";
import { categoryIcon } from "@/components/budget/categoryIcons";
import type { Birthday, Event, Expense, ExpenseCategory } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { expandBirthdayOccurrences, currentAge } from "@/utils/birthday";
import { addDays } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { stavkeLabel } from "@/utils/plural";
import { useToday } from "@/hooks/useToday";

/**
 * The budget month as a single day-grouped timeline: expenses (which already
 * fold in paid payments via the DB trigger, tagged "iz plaćanja"), plus the
 * month's events and birthdays for context — the same "Uskoro"/payments day
 * grouping applied to the ledger. `filter` narrows to one kind. Expenses keep
 * their affordances (manual → edit/delete, receipt → detail); events and
 * birthdays are read-only context managed on their own pages.
 */
export type BudgetFilterKind = "all" | "expense" | "event" | "birthday";

export type BudgetTimelineProps = {
  expenses: Expense[];
  events: Event[];
  birthdays: Birthday[];
  range: { from: string; to: string };
  filter: BudgetFilterKind;
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  itemCounts: Record<string, number> | undefined;
  onOpenReceipt: (expense: Expense) => void;
  onEditManual: (expense: Expense) => void;
  onDeleteExpense: (expense: Expense) => void;
};

type BudgetRow =
  | { kind: "expense"; date: string; sortKey: number; expense: Expense }
  | { kind: "event"; date: string; sortKey: number; event: Event }
  | { kind: "birthday"; date: string; sortKey: number; birthday: Birthday };

const ALL_DAY_SORT = 24 * 60 + 1;
const EXPENSE_SORT = ALL_DAY_SORT + 1;
const BIRTHDAY_SORT = ALL_DAY_SORT + 2;

function timeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function eventTimeLabel(event: Event): string {
  const start = event.start_time ? normalizeTime(event.start_time) : null;
  const end = event.end_time ? normalizeTime(event.end_time) : null;
  if (!start) return "ceo dan";
  return end ? `${start}–${end}` : start;
}

function ExpenseRow({
  expense,
  categoriesById,
  itemCounts,
  onOpenReceipt,
  onEditManual,
  onDeleteExpense,
}: {
  expense: Expense;
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  itemCounts: Record<string, number> | undefined;
  onOpenReceipt: (expense: Expense) => void;
  onEditManual: (expense: Expense) => void;
  onDeleteExpense: (expense: Expense) => void;
}) {
  const category = expense.category_id ? categoriesById.get(expense.category_id) : null;
  const Icon = categoryIcon(category?.icon);
  const color = category?.color ?? "#9ca3af";
  const isReceipt = expense.source === "receipt";
  const isPayment = expense.source === "payment";
  const itemCount = isReceipt ? (itemCounts?.[expense.id] ?? 0) : 0;
  const primary = isReceipt
    ? expense.merchant || expense.note?.trim() || category?.name || "Račun"
    : expense.note?.trim() || category?.name || "Trošak";

  const inner = (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}22` }}
      >
        <Icon className="size-5" style={{ color }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {primary}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {formatAmount(expense.amount)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {isPayment ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
              <LockClosedIcon className="size-2.5" />
              iz plaćanja
            </span>
          ) : isReceipt ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              <ReceiptPercentIcon className="size-2.5" />
              račun
            </span>
          ) : null}
          {isReceipt && itemCount > 0 ? (
            <span className="truncate">
              {itemCount} {stavkeLabel(itemCount)}
            </span>
          ) : category ? (
            <span className="truncate">{category.name}</span>
          ) : null}
          <span className="shrink-0">
            <MemberBadges personIds={expense.person_id ? [expense.person_id] : []} size="xs" />
          </span>
        </span>
      </span>
    </>
  );

  // Receipt: whole row taps into the receipt detail.
  if (isReceipt) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpenReceipt(expense)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:hover:bg-gray-800/70"
        >
          {inner}
          <ChevronRightIcon className="size-4 shrink-0 text-gray-300 dark:text-gray-600" />
        </button>
      </li>
    );
  }

  // Payment-sourced: read-only.
  if (isPayment) {
    return <li className="flex items-center gap-3 rounded-lg px-2 py-2">{inner}</li>;
  }

  // Manual: inline edit + delete.
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2">
      {inner}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Izmeni trošak"
          onClick={() => onEditManual(expense)}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <PencilSquareIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Obriši trošak"
          onClick={() => onDeleteExpense(expense)}
          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        >
          <TrashIcon className="size-4" />
        </button>
      </div>
    </li>
  );
}

function EventRow({ event }: { event: Event }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
        <CalendarIcon className="size-5 text-blue-600 dark:text-blue-400" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {event.name}
          </span>
          <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">
            {eventTimeLabel(event)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="truncate">{event.description?.trim() || "Događaj"}</span>
        </span>
      </span>
    </li>
  );
}

function BirthdayRow({ birthday }: { birthday: Birthday }) {
  const nextAge = currentAge(birthday.birth_date) + 1;
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/30">
        <CakeIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {birthday.name}
        </span>
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
          {nextAge}. rođendan
        </span>
      </span>
    </li>
  );
}

export function BudgetTimeline({
  expenses,
  events,
  birthdays,
  range,
  filter,
  categoriesById,
  itemCounts,
  onOpenReceipt,
  onEditManual,
  onDeleteExpense,
}: BudgetTimelineProps) {
  const { str: today, date: todayDate } = useToday();
  const tomorrow = useMemo(() => format(addDays(todayDate, 1), "yyyy-MM-dd"), [todayDate]);

  const dayGroups = useMemo(() => {
    const byDay = new Map<string, BudgetRow[]>();
    const push = (date: string, row: BudgetRow) => {
      const bucket = byDay.get(date);
      if (bucket) bucket.push(row);
      else byDay.set(date, [row]);
    };

    if (filter === "all" || filter === "expense") {
      for (const e of expenses) {
        push(e.spent_on, { kind: "expense", date: e.spent_on, sortKey: EXPENSE_SORT, expense: e });
      }
    }
    if (filter === "all" || filter === "event") {
      for (const ev of events) {
        if (ev.canceled_at) continue;
        const start = ev.start_time ? normalizeTime(ev.start_time) : null;
        push(ev.date, {
          kind: "event",
          date: ev.date,
          sortKey: start ? timeToMin(start) : ALL_DAY_SORT,
          event: ev,
        });
      }
    }
    if (filter === "all" || filter === "birthday") {
      for (const b of birthdays) {
        for (const occ of expandBirthdayOccurrences(b, range.from, range.to)) {
          push(occ.date, { kind: "birthday", date: occ.date, sortKey: BIRTHDAY_SORT, birthday: b });
        }
      }
    }

    const groups = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, rows] of groups) rows.sort((a, b) => a.sortKey - b.sortKey);
    return groups;
  }, [expenses, events, birthdays, range, filter]);

  if (dayGroups.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        Nema stavki za ovaj mesec.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dayGroups.map(([day, rows]) => (
        <section key={day}>
          <AgendaDateHeader day={day} today={today} tomorrow={tomorrow} />
          <ul className="mt-2 space-y-1">
            {rows.map((row) => {
              switch (row.kind) {
                case "expense":
                  return (
                    <ExpenseRow
                      key={`e-${row.expense.id}`}
                      expense={row.expense}
                      categoriesById={categoriesById}
                      itemCounts={itemCounts}
                      onOpenReceipt={onOpenReceipt}
                      onEditManual={onEditManual}
                      onDeleteExpense={onDeleteExpense}
                    />
                  );
                case "event":
                  return <EventRow key={`ev-${row.event.id}`} event={row.event} />;
                case "birthday":
                  return (
                    <BirthdayRow key={`b-${row.birthday.id}-${row.date}`} birthday={row.birthday} />
                  );
              }
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
