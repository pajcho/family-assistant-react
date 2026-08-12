import { useState } from "react";
import type { ReactNode } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";

import { PickerOverlay } from "@/components/common/PickerOverlay";
import { PickerRow } from "@/components/common/PickerRow";
import { cn } from "@/lib/cn";

/**
 * Pick one of a handful of options, as a field row that opens the app's own
 * overlay - the `DateField` / `TimeField` shape, for a plain list of choices.
 *
 * It exists so a form does not have to choose between a NATIVE `<select>` (a
 * different control on every platform, and an iOS wheel that hides the form
 * behind it) and a run of full-width option buttons that eats a screenful for
 * four words. The row reads back the current choice; the options only appear
 * when somebody asks for them.
 *
 * Picking closes the overlay: these are single choices, so a confirm step would
 * be a tap that never changes the answer.
 */
export type OptionPickerOption<T extends string | number> = {
  value: T;
  label: string;
  /** Optional second line inside the option, for a choice that needs a word. */
  description?: string;
};

export function OptionPickerRow<T extends string | number>({
  title,
  value,
  options,
  onChange,
  icon,
  overlayTitle,
  description,
  disabled = false,
}: {
  title: string;
  value: T;
  options: readonly OptionPickerOption<T>[];
  onChange: (next: T) => void;
  icon?: ReactNode;
  /** Heading inside the overlay. Defaults to the row's own title. */
  overlayTitle?: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <PickerOverlay
      open={open}
      onOpenChange={setOpen}
      title={overlayTitle ?? title}
      description={description}
      trigger={({ onOpen }) => (
        <PickerRow
          title={title}
          summary={current?.label ?? ""}
          icon={icon}
          disabled={disabled}
          onClick={onOpen}
        />
      )}
    >
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              type="button"
              key={option.value}
              aria-pressed={selected}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
                selected
                  ? "border-accent bg-accent-soft text-accent-deep"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-normal">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block truncate text-xs font-normal opacity-70">
                    {option.description}
                  </span>
                ) : null}
              </span>
              {selected ? <CheckIcon className="size-4 shrink-0" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </PickerOverlay>
  );
}
