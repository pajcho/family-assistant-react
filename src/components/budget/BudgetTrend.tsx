import { useMemo } from "react";

import { useExpenses } from "@/hooks/useExpenses";
import { monthOf, monthRange, shiftMonth } from "@/utils/budget";
import { cn } from "@/lib/cn";

export type BudgetTrendProps = {
  /** The currently selected "YYYY-MM"; the window is the 6 months ending here. */
  month: string;
  onSelectMonth: (month: string) => void;
};

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Maj",
  "Jun",
  "Jul",
  "Avg",
  "Sep",
  "Okt",
  "Nov",
  "Dec",
] as const;

function shortMonthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return SHORT_MONTHS[(m - 1) % 12] ?? month;
}

/** Compact RSD amount for a bar label: 12.500 → "13k", 800 → "800". */
function compact(amount: number): string {
  if (amount >= 1000) return `${Math.round(amount / 1000)}k`;
  return String(Math.round(amount));
}

/**
 * Last-6-months total-spend bar chart (pure CSS). Bars are proportional to the
 * biggest month in the window; the selected month is highlighted. Tapping a bar
 * jumps to that month. Dark-mode aware.
 */
export function BudgetTrend({ month, onSelectMonth }: BudgetTrendProps) {
  // The 6 months ending at `month` (oldest → newest).
  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = 5; i >= 0; i--) out.push(shiftMonth(month, -i));
    return out;
  }, [month]);

  const range = useMemo(
    () => ({ from: monthRange(months[0]).from, to: monthRange(months[5]).to }),
    [months],
  );
  const { expenses } = useExpenses(range);

  const totalsByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      const key = monthOf(e.spent_on);
      m.set(key, (m.get(key) ?? 0) + e.amount);
    }
    return m;
  }, [expenses]);

  const bars = months.map((mo) => ({ month: mo, total: totalsByMonth.get(mo) ?? 0 }));
  const max = Math.max(1, ...bars.map((b) => b.total));

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">
        Trend (6 meseci)
      </h2>
      <div className="flex items-end justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {bars.map((bar) => {
          const isSelected = bar.month === month;
          const heightPct = bar.total > 0 ? Math.max((bar.total / max) * 100, 4) : 2;
          return (
            <button
              type="button"
              key={bar.month}
              onClick={() => onSelectMonth(bar.month)}
              aria-label={`${shortMonthLabel(bar.month)} ${bar.month.slice(0, 4)}`}
              aria-pressed={isSelected}
              className="group flex flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  isSelected
                    ? "font-semibold text-gray-900 dark:text-gray-100"
                    : "text-gray-400 dark:text-gray-500",
                )}
              >
                {compact(bar.total)}
              </span>
              <div className="flex h-24 w-full items-end justify-center">
                <div
                  className={cn(
                    "w-full max-w-8 rounded-t-md transition-[height,background-color]",
                    isSelected
                      ? "bg-blue-500 dark:bg-blue-400"
                      : "bg-gray-200 group-hover:bg-gray-300 dark:bg-gray-600 dark:group-hover:bg-gray-500",
                  )}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-[11px]",
                  isSelected
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400",
                )}
              >
                {shortMonthLabel(bar.month)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
