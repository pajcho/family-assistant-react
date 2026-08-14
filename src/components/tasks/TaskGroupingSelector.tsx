import { useState } from "react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";

import { PickerOverlay } from "@/components/common/PickerOverlay";
import { cn } from "@/lib/cn";
import type { TaskGrouping } from "@/components/tasks/TaskListBody";

/**
 * The labelled control that replaced the sparkles icon.
 *
 * Smart sort used to be a bare ✨ that appeared in the header of some lists and
 * nowhere else, with nothing on screen saying what it did or that it existed.
 * It is now one of four named ways to arrange a list, behind a row that says
 * "Grupisanje" and reads back the current choice - so the feature is findable,
 * and the three arrangements it was hiding beside it are too.
 *
 * "Po rafovima" IS the persisted `lists.smart_sort_enabled` flag, so it is only
 * offered on lists the categoriser recognises as shopping; the other three are a
 * view choice the screen holds. Picking one of them turns the flag off, which is
 * non-destructive - the manual order underneath is never rewritten.
 */

export type TaskGroupingSelectorProps = {
  value: TaskGrouping;
  onChange: (value: TaskGrouping) => void;
  /** Offer "Po rafovima" - true only where the categoriser recognises the list. */
  allowAisle: boolean;
  disabled?: boolean;
};

const OPTION_LABEL: Record<TaskGrouping, string> = {
  manual: "Ručni redosled",
  date: "Po datumu",
  aisle: "Po rafovima",
  person: "Po osobi",
};

const OPTION_HINT: Record<TaskGrouping, string> = {
  manual: "Onako kako si ih poređao - prevlačenjem.",
  date: "Kasni, danas, sutra, pa bez datuma.",
  aisle: "Grupisano po rafovima u marketu.",
  person: "Grupisano po tome čiji je zadatak.",
};

const ORDER: ReadonlyArray<TaskGrouping> = ["manual", "date", "aisle", "person"];

export function TaskGroupingSelector({
  value,
  onChange,
  allowAisle,
  disabled = false,
}: TaskGroupingSelectorProps) {
  const [open, setOpen] = useState(false);
  const options = ORDER.filter((option) => option !== "aisle" || allowAisle);

  return (
    <PickerOverlay
      open={open}
      onOpenChange={setOpen}
      title="Grupisanje"
      description="Kako su zadaci poređani u ovoj listi."
      trigger={({ onOpen }) => (
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          aria-label={`Grupisanje: ${OPTION_LABEL[value]}`}
          className={cn(
            "flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5",
            "text-[11.5px] font-semibold whitespace-nowrap transition-colors hover:bg-muted",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <span className="font-normal text-muted-foreground">Grupisanje</span>
          {OPTION_LABEL[value]}
          <ChevronDownIcon className="size-3 text-muted-foreground" aria-hidden="true" />
        </button>
      )}
    >
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2 text-left transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
                selected ? "border-accent bg-accent-soft" : "border-border hover:bg-muted",
              )}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    selected ? "text-accent-deep" : "text-foreground",
                  )}
                >
                  {OPTION_LABEL[option]}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {OPTION_HINT[option]}
                </span>
              </span>
              {selected ? (
                <CheckIcon className="size-4 shrink-0 text-accent-deep" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </PickerOverlay>
  );
}
