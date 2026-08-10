import { FilterChip } from "@/components/common/FilterChips";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useMemberEmoji } from "@/hooks/useMemberAvatarStyle";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

/**
 * One `FilterChip` per family member - the member half of every filter row in
 * the app (today, calendar, payments, budget).
 *
 * It was written out four times and the copies drifted: two of them never got
 * the member emoji, so the same person was drawn differently depending on which
 * screen you were on. One implementation now decides what a member chip looks
 * like - colour tint, emoji (when the viewer reads members as emoji) and the
 * first-name label.
 *
 * Chips only, no row wrapper: every caller has its own leading chips ("Svi" /
 * "Sve" / "Sva", type facets, categories) and the members come after them in
 * the SAME scrolling row.
 *
 * Filter SEMANTICS stay with the caller - this component only renders what is
 * selected and reports toggles. The callers disagree on what an empty selection
 * means, and that is deliberately not unified here.
 */
export type MemberFilterChipsProps = {
  selected: ReadonlySet<string>;
  onToggle: (personId: string) => void;
};

export function MemberFilterChips({ selected, onToggle }: MemberFilterChipsProps) {
  const { members } = useFamilyMembers();
  const memberEmoji = useMemberEmoji();

  // With one member (a brand-new family) there is nobody to narrow to - the
  // chips would offer a filter that filters nothing. Same rule on all four
  // screens.
  if (members.length <= 1) return null;

  // A fragment rather than `PersonFilterChips`' `display: contents` wrapper:
  // the chips have to join the caller's `FilterChipRow` flex flow, and emitting
  // no element at all keeps the DOM byte-identical to the inline blocks this
  // replaces - the four rows must not shift by a pixel.
  return (
    <>
      {members.map((member) => (
        <FilterChip
          key={member.id}
          active={selected.has(member.id)}
          onToggle={() => onToggle(member.id)}
          color={member.color ?? fallbackColorForProfile(member.id)}
          emoji={memberEmoji(member)}
        >
          {getDisplayName({
            firstName: member.first_name,
            lastName: member.last_name,
            email: null,
          }) || "Bez imena"}
        </FilterChip>
      ))}
    </>
  );
}
