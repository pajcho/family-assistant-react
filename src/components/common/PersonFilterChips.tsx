import { PersonChip } from "@/components/activities/PersonChip";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";

/**
 * Row of person filter chips - the same `PersonChip` (colored dot + name) the
 * activities header and the dashboard's `AgendaFilters` use, wrapped with the
 * shared selection convention: an EMPTY selection means "no filter" (every
 * chip reads as active); clicking narrows to the clicked member(s).
 *
 * Pure presentation over a `ReadonlySet` the page owns - the matching rule
 * (items must be assigned to at least one selected member; unassigned items
 * hide while a filter is active) lives with the caller, mirroring
 * `matchesAgendaFilter`.
 */
export type PersonFilterChipsProps = {
  selected: ReadonlySet<string>;
  onToggle: (personId: string) => void;
};

export function PersonFilterChips({ selected, onToggle }: PersonFilterChipsProps) {
  const { members } = useFamilyMembers();

  if (members.length === 0) return null;

  // `display: contents` - the chips join the PARENT's flex-wrap flow, so a
  // sibling ToggleChip ("Sakrij plaćena" / "Sakrij završene") wraps inline
  // with the member chips instead of after the whole block.
  return (
    <div className="contents">
      {members.map((member) => (
        <PersonChip
          key={member.id}
          person={member}
          active={selected.size === 0 || selected.has(member.id)}
          onToggle={() => onToggle(member.id)}
        />
      ))}
    </div>
  );
}
