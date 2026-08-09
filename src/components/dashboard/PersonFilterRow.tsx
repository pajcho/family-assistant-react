import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";

/**
 * The Danas person filter: a "Svi" chip plus one chip per family member.
 *
 * The same chips Kalendar uses (`AgendaFilters`' member half) rather than the
 * initial-only avatar rings this used to draw - two spellings of one control on
 * two screens made you re-learn it, and "AP" is not a name. With first names
 * only (see `getDisplayName`) the labelled chips fit a phone comfortably.
 *
 * The filter SEMANTICS are unchanged: this drives the same `filter.personIds`
 * set the agenda has always used (birthdays stay exempt - see
 * `matchesAgendaFilter`).
 */
export function PersonFilterRow({
  selected,
  onToggle,
  onClear,
}: {
  selected: ReadonlySet<string>;
  onToggle: (personId: string) => void;
  onClear: () => void;
}) {
  const { members } = useFamilyMembers();
  // With one member (a brand-new family) there is nobody to narrow to - the
  // row would be "Svi + that one person", which filters nothing. The whole row
  // goes, "Svi" chip included (`MemberFilterChips` drops itself on the same
  // rule, but the leading chip is this component's own).
  if (members.length <= 1) return null;

  return (
    <FilterChipRow ariaLabel="Filter po članu">
      {/* "Svi" carries the neutral state on its own, like the calendar's row -
          the member chips light up only when actually picked. */}
      <FilterChip active={selected.size === 0} onToggle={onClear}>
        Svi
      </FilterChip>
      <MemberFilterChips selected={selected} onToggle={onToggle} />
    </FilterChipRow>
  );
}
