import type { ComponentType, ReactNode, SVGProps } from "react";

import { FilterChip } from "@/components/common/FilterChips";

/**
 * Pill-shaped boolean filter toggle - the chip idiom the events page
 * introduced for "Sakrij završene", extracted so every page's list filters
 * (plaćanja, događaji, rođendani) read the same.
 *
 * Redizajn 2.0 made the chip a single shape app-wide, so this is now a thin
 * alias over {@link FilterChip}: same pill, same accent fill when on, same
 * 44px tap target. `aria-pressed` carries the state for screen readers.
 */
export type ToggleChipProps = {
  active: boolean;
  onToggle: () => void;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  children: ReactNode;
  className?: string;
};

export function ToggleChip({ active, onToggle, icon, children, className }: ToggleChipProps) {
  return (
    <FilterChip active={active} onToggle={onToggle} icon={icon} className={className}>
      {children}
    </FilterChip>
  );
}
