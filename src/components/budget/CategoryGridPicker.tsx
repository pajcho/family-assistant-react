import { NoSymbolIcon } from "@heroicons/react/24/outline";

import { Tile, TileGrid } from "@/components/common/FormControls";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";

/**
 * Tappable grid of category tiles - the same visual as ExpenseForm's inline
 * grid, packaged for the "Brzi unos" Kategorija sub-view. Self-fetches the
 * category list; the parent owns only the selected id (`null` = "Bez
 * kategorije", offered as the first tile). Every tap selects (no toggle):
 * in the sub-view flow the caller pops back right after `onChange`.
 */
export type CategoryGridPickerProps = {
  value: string | null;
  onChange: (categoryId: string | null) => void;
};

export function CategoryGridPicker({ value, onChange }: CategoryGridPickerProps) {
  const { categories } = useExpenseCategories();

  return (
    <TileGrid>
      <Tile
        icon={NoSymbolIcon}
        label="Bez kategorije"
        selected={value === null}
        onClick={() => onChange(null)}
      />
      {categories.map((c) => {
        const selected = value === c.id;
        return (
          <Tile
            key={c.id}
            icon={categoryIcon(c.icon)}
            iconColor={c.color ?? undefined}
            label={c.name}
            selected={selected}
            onClick={() => onChange(c.id)}
            style={selected ? { backgroundColor: `${c.color}1F`, borderColor: c.color } : undefined}
            className={selected ? "text-foreground" : undefined}
          />
        );
      })}
    </TileGrid>
  );
}
