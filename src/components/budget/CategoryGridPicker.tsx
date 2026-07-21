import { NoSymbolIcon } from "@heroicons/react/24/outline";

import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { cn } from "@/lib/cn";

/**
 * Tappable grid of category tiles — the same visual as ExpenseForm's inline
 * grid, packaged for the "Brzi unos" Kategorija sub-view. Self-fetches the
 * category list; the parent owns only the selected id (`null` = "Bez
 * kategorije", offered as the first tile). Every tap selects (no toggle):
 * in the sub-view flow the caller pops back right after `onChange`.
 */
export type CategoryGridPickerProps = {
  value: string | null;
  onChange: (categoryId: string | null) => void;
};

const TILE_BASE = cn(
  "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
);
const TILE_IDLE =
  "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800";

export function CategoryGridPicker({ value, onChange }: CategoryGridPickerProps) {
  const { categories } = useExpenseCategories();

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          TILE_BASE,
          value === null
            ? "border-gray-400 bg-gray-100 text-gray-900 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-100"
            : TILE_IDLE,
        )}
      >
        <NoSymbolIcon className="size-5 shrink-0 text-gray-400" aria-hidden="true" />
        <span className="w-full truncate text-[11px] leading-tight">Bez kategorije</span>
      </button>
      {categories.map((c) => {
        const selected = value === c.id;
        const Icon = categoryIcon(c.icon);
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onChange(c.id)}
            aria-pressed={selected}
            style={selected ? { backgroundColor: `${c.color}1F`, borderColor: c.color } : undefined}
            className={cn(TILE_BASE, selected ? "text-gray-900 dark:text-gray-100" : TILE_IDLE)}
          >
            <Icon className="size-5 shrink-0" style={{ color: c.color }} aria-hidden="true" />
            <span className="w-full truncate text-[11px] leading-tight">{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}
