import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { AGENDA_KIND_META } from "@/components/dashboard/agendaKindMeta";
import { useHasExternalEvents } from "@/hooks/useExternalEvents";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { AGENDA_KINDS, type AgendaFilter, type AgendaKind } from "@/utils/agendaFilters";
import { getDisplayName } from "@/utils/identity";

/**
 * Shared agenda filter row - item type + family member - applied identically to
 * all three calendar views and to Danas.
 *
 * Redizajn 2.0 pulled the facets out of the "Filteri" sheet and onto one
 * swipeable chip line, the way the prototype shows them: a leading "Sve" chip
 * that clears everything, then the five types, then the family members.
 *
 * Filtering itself is unchanged: an EMPTY selection means "no filter" and a
 * non-empty one narrows to what is picked. What the redesign changes is how the
 * NEUTRAL state is drawn. It used to light every chip, which read as "click one
 * to hide it" even though clicking one has always narrowed TO it. Now the "Sve"
 * chip carries the neutral state on its own and the facet chips stay unlit
 * until they are actually selected, so the row says what it does.
 */
export type AgendaFiltersProps = {
  filter: AgendaFilter;
  toggleKind: (kind: AgendaKind) => void;
  togglePerson: (personId: string) => void;
  reset: () => void;
  isActive: boolean;
  /**
   * Number of selected facets. The sheet-based bar used it for a badge; the
   * inline chips show the selection directly, so it is accepted (Danas still
   * passes it) and ignored.
   */
  count?: number;
};

export function AgendaFilters({
  filter,
  toggleKind,
  togglePerson,
  reset,
  isActive,
}: AgendaFiltersProps) {
  const { members } = useFamilyMembers();
  const hasExternalEvents = useHasExternalEvents();

  // Only what is actually selected is lit - "Sve" holds the neutral state.
  const kindActive = (kind: AgendaKind) => filter.kinds.has(kind);
  const personActive = (id: string) => filter.personIds.has(id);

  // "Google" is only a real facet once the family actually mirrors a calendar;
  // until then the chip filters on a source that cannot produce items. It stays
  // while selected so a lit chip can always be un-picked.
  const kinds = AGENDA_KINDS.filter(
    (kind) => kind !== "external" || hasExternalEvents || kindActive(kind),
  );
  // Same reasoning for a one-member (brand-new) family: there is nobody to
  // narrow to, so the member half of the row says nothing.
  const memberChips = members.length > 1 ? members : [];

  return (
    <FilterChipRow ariaLabel="Filteri">
      <FilterChip active={!isActive} onToggle={reset}>
        Sve
      </FilterChip>
      {kinds.map((kind) => (
        <FilterChip
          key={kind}
          active={kindActive(kind)}
          onToggle={() => toggleKind(kind)}
          icon={AGENDA_KIND_META[kind].icon}
        >
          {AGENDA_KIND_META[kind].label}
        </FilterChip>
      ))}
      {memberChips.length > 0 ? (
        <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      ) : null}
      {memberChips.map((member) => (
        <FilterChip
          key={member.id}
          active={personActive(member.id)}
          onToggle={() => togglePerson(member.id)}
          color={member.color ?? fallbackColorForProfile(member.id)}
        >
          {getDisplayName({
            firstName: member.first_name,
            lastName: member.last_name,
            email: null,
          }) || "Bez imena"}
        </FilterChip>
      ))}
    </FilterChipRow>
  );
}
