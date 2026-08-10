import { useState } from "react";
import { NoSymbolIcon, TagIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/common/FilterChips";
import { Tile, TileGrid } from "@/components/common/FormControls";
import { categoryIcon } from "@/components/budget/categoryIcons";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { UNCATEGORIZED, toggleInSet } from "@/utils/categoryFilter";
import { serbianPlural } from "@/utils/plural";

/**
 * The category facet shared by the expenses and payments views.
 *
 * Sources and members are chips in the filter row because there are three of
 * them and two of them; categories are ten-plus and family-defined, so the same
 * treatment would push the row off screen before it ever fit. One chip carries
 * the whole facet instead and opens the tile grid the forms already use, in
 * multi-select mode.
 *
 * "Bez kategorije" is a first-class option, not an omission: "what did I forget
 * to classify" is one of the two questions this filter actually gets asked.
 */

export function CategoryFilterChip({
  selected,
  onChange,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const { categories } = useExpenseCategories();

  // A family with no categories yet has nothing to filter by - the chip would
  // open onto a single "Bez kategorije" tile that matches every row.
  if (categories.length === 0) return null;

  const count = selected.size;
  const onlyKey = count === 1 ? [...selected][0] : null;
  const onlyCategory = onlyKey ? categories.find((c) => c.id === onlyKey) : undefined;

  // One selection names itself (and carries its colour); several collapse to a
  // count, because a list of category names outgrows the chip immediately.
  const label =
    count === 0
      ? "Kategorija"
      : onlyKey === UNCATEGORIZED
        ? "Bez kategorije"
        : onlyCategory
          ? onlyCategory.name
          : `${count} ${serbianPlural(count, {
              one: "kategorija",
              few: "kategorije",
              many: "kategorija",
            })}`;

  return (
    <>
      <FilterChip
        active={count > 0}
        onToggle={() => setOpen(true)}
        icon={onlyCategory ? undefined : TagIcon}
        color={onlyCategory?.color ?? undefined}
      >
        {label}
      </FilterChip>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Kategorija</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <TileGrid>
            <Tile
              icon={NoSymbolIcon}
              label="Bez kategorije"
              selected={selected.has(UNCATEGORIZED)}
              onClick={() => onChange(toggleInSet(selected, UNCATEGORIZED))}
            />
            {categories.map((c) => {
              const isSelected = selected.has(c.id);
              return (
                <Tile
                  key={c.id}
                  icon={categoryIcon(c.icon)}
                  iconColor={c.color ?? undefined}
                  label={c.name}
                  selected={isSelected}
                  onClick={() => onChange(toggleInSet(selected, c.id))}
                  style={
                    isSelected
                      ? { backgroundColor: `${c.color}1F`, borderColor: c.color }
                      : undefined
                  }
                  className={isSelected ? "text-foreground" : undefined}
                />
              );
            })}
          </TileGrid>

          {/* Same contract as FilterSheet: taps apply live, the footer only
              closes - so there is no "apply" step to forget. */}
          <ResponsiveDialogFooter className="mt-6 flex-row items-center gap-2">
            {count > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                onClick={() => onChange(new Set())}
              >
                Poništi
              </Button>
            ) : null}
            <Button type="button" className="flex-1 sm:flex-none" onClick={() => setOpen(false)}>
              Gotovo
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
