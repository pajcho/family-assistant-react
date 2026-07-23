import { Link } from "@tanstack/react-router";
import { CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import type { FirstStep, UseFirstStepsResult } from "@/hooks/useFirstSteps";
import { cn } from "@/lib/cn";

/**
 * The "Prvi koraci" card on Danas - a 5-step checklist that walks a fresh
 * family to their first useful state. Purely presentational: statuses and
 * dismissal come from `useFirstSteps` (owned by DashboardScope so the same
 * signal can also soften the day's empty-state copy).
 *
 * Every todo row leads STRAIGHT INTO the matching flow (an open form or the
 * right settings tab), not merely to a page.
 */
export type FirstStepsCardProps = {
  firstSteps: UseFirstStepsResult;
  onAddEvent: () => void;
  onAddPayment: () => void;
};

export function FirstStepsCard({ firstSteps, onAddEvent, onAddPayment }: FirstStepsCardProps) {
  const { steps, doneCount, hide, hiding } = firstSteps;
  const progressPct = (doneCount / steps.length) * 100;

  return (
    <section
      aria-label="Prvi koraci"
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">👋 Prvi koraci</h2>
        <button
          type="button"
          onClick={hide}
          disabled={hiding}
          className="text-xs font-medium text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          Sakrij
        </button>
      </div>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {doneCount} od {steps.length} · još malo pa je sve spremno
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] dark:bg-blue-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700/60">
        {steps.map((step) => (
          <li key={step.id}>
            <StepRow step={step} onAddEvent={onAddEvent} onAddPayment={onAddPayment} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StepRow({
  step,
  onAddEvent,
  onAddPayment,
}: {
  step: FirstStep;
  onAddEvent: () => void;
  onAddPayment: () => void;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          step.done
            ? "bg-emerald-100 dark:bg-emerald-900/40"
            : "border-[1.5px] border-dashed border-gray-300 dark:border-gray-600",
        )}
      >
        {step.done ? (
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : null}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-sm",
          step.done
            ? "text-gray-400 line-through dark:text-gray-500"
            : "font-medium text-gray-900 dark:text-gray-100",
        )}
      >
        {step.label}
      </span>
      {!step.done ? (
        <ChevronRightIcon className="size-4 shrink-0 text-gray-300 dark:text-gray-600" />
      ) : null}
    </>
  );

  if (step.done) {
    return <div className="flex items-center gap-2.5 py-2.5">{inner}</div>;
  }

  const rowClass =
    "flex w-full items-center gap-2.5 rounded-md py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40";

  // Todo rows: settings steps deep-link to the right tab; the calendar and
  // payment steps open the add flows the dashboard already owns.
  switch (step.id) {
    case "profile":
      return (
        <Link to="/settings" className={rowClass}>
          {inner}
        </Link>
      );
    case "members":
      return (
        <Link to="/settings" search={{ tab: "family" }} className={rowClass}>
          {inner}
        </Link>
      );
    case "calendar":
      return (
        <button type="button" onClick={onAddEvent} className={rowClass}>
          {inner}
        </button>
      );
    case "payment":
      return (
        <button type="button" onClick={onAddPayment} className={rowClass}>
          {inner}
        </button>
      );
    default:
      return <div className="flex items-center gap-2.5 py-2.5">{inner}</div>;
  }
}
