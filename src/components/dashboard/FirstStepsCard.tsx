import { Link } from "@tanstack/react-router";
import { CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import type { FirstStep, UseFirstStepsResult } from "@/hooks/useFirstSteps";
import { cn } from "@/lib/cn";

/**
 * The "Prvi koraci" card on Danas - a 5-step checklist that walks a fresh
 * family to their first useful state. Purely presentational: statuses and
 * dismissal come from `useFirstSteps` (owned by TodayScreen so the same
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
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-extrabold tracking-tight">👋 Prvi koraci</h2>
        <button
          type="button"
          onClick={hide}
          disabled={hiding}
          className="text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          Sakrij
        </button>
      </div>
      <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
        {doneCount} od {steps.length} · još malo pa je sve spremno
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ul className="mt-2 divide-y divide-border">
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
          step.done ? "bg-pos-soft" : "border-[1.5px] border-dashed border-border",
        )}
      >
        {step.done ? <CheckIcon className="size-3.5 text-pos" /> : null}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-sm",
          step.done ? "text-muted-foreground line-through" : "font-semibold",
        )}
      >
        {step.label}
      </span>
      {!step.done ? (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
      ) : null}
    </>
  );

  if (step.done) {
    return <div className="flex items-center gap-2.5 py-2.5">{inner}</div>;
  }

  const rowClass =
    "flex w-full items-center gap-2.5 rounded-md py-2.5 text-left transition-colors hover:bg-muted";

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
