import { useMemo } from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { Button } from "@/components/ui/button";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/cn";

/**
 * The shared filter sheet — bottom drawer on mobile, dialog on desktop — that
 * every list page opens from `FilterTriggerButton`. Pages compose it from
 * `FilterSection` (uppercase heading + chip row) and `FilterSwitchRow`
 * (labelled switch for boolean view options). Changes apply live; "Gotovo"
 * only closes. "Poništi sve" appears once any non-default filter is on.
 */
export type FilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Any non-default filter applied — shows the "Poništi sve" affordance. */
  isActive: boolean;
  onReset: () => void;
  children: ReactNode;
};

export function FilterSheet({ open, onOpenChange, isActive, onReset, children }: FilterSheetProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Filteri</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-5">{children}</div>
        <ResponsiveDialogFooter className="mt-6 flex-row items-center gap-2">
          {isActive ? (
            <Button
              type="button"
              variant="ghost"
              className="shrink-0 text-muted-foreground"
              onClick={onReset}
            >
              Poništi sve
            </Button>
          ) : null}
          <Button type="button" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
            Gotovo
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Uppercase section heading + a wrapping chip row. */
export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/**
 * Labelled boolean row with a switch — for view options ("Prikaži i plaćena")
 * that aren't chips. Plain button underneath (`role="switch"`), no Radix dep.
 */
export function FilterSwitchRow({
  label,
  icon: Icon,
  checked,
  onCheckedChange,
}: {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-sm font-medium text-gray-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:text-gray-200"
    >
      <span className="flex items-center gap-2">
        {Icon ? <Icon className="size-4 text-gray-400 dark:text-gray-500" /> : null}
        {label}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

/**
 * The applied-filters row under the toolbar: one removable chip per active
 * filter + "Poništi". Renders nothing when no filter is applied, so the row
 * costs zero chrome in the default state — but an active filter is never
 * invisible (the classic hidden-filter trap of overflow patterns).
 */
export type AppliedFilter = {
  key: string;
  label: string;
  /** Member color dot, when the filter is a person. */
  color?: string;
  onRemove: () => void;
};

export function AppliedFilterChips({
  filters,
  onClearAll,
}: {
  filters: AppliedFilter[];
  onClearAll: () => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-200"
        >
          {f.color ? (
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: f.color }}
              aria-hidden="true"
            />
          ) : null}
          {f.label}
          <button
            type="button"
            aria-label={`Ukloni filter ${f.label}`}
            onClick={f.onRemove}
            className="rounded-full p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/50"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        </span>
      ))}
      {filters.length > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Poništi
        </button>
      ) : null}
    </div>
  );
}

/** Applied-chip entries for the selected members (name + color dot). */
export function useMemberAppliedFilters(
  selected: ReadonlySet<string>,
  onToggle: (personId: string) => void,
): AppliedFilter[] {
  const { members } = useFamilyMembers();
  return useMemo(
    () =>
      members
        .filter((m) => selected.has(m.id))
        .map((m) => ({
          key: m.id,
          label:
            getDisplayName({ firstName: m.first_name, lastName: m.last_name, email: null }) ||
            "Bez imena",
          color: m.color ?? fallbackColorForProfile(m.id),
          onRemove: () => onToggle(m.id),
        })),
    [members, selected, onToggle],
  );
}
