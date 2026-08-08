import { Chip, ChipRow, FieldGroupLabel, FieldHint } from "@/components/common/FormControls";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useMemberEmoji } from "@/hooks/useMemberAvatarStyle";
import type { Profile } from "@/types/database";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

export type MemberMultiSelectProps = {
  /** Selected person ids. */
  value: string[];
  onChange: (personIds: string[]) => void;
  label?: string;
  /** Helper line under the pills (e.g. "opciono"). */
  hint?: string;
  /**
   * Narrow the roster to a subset (raspusti offer only children who actually
   * have a timetable). Omit for the whole family.
   */
  people?: ReadonlyArray<Profile>;
  /** Shown instead of the pills when the roster is empty. */
  emptyLabel?: string;
};

/**
 * Inline toggle pills for assigning an event / payment to one or more people.
 * Self-fetches the roster; the parent owns only the selected ids. Compact
 * (wraps, no bordered box) and matches the `PersonChip` filter style - a
 * selected pill gets the person's color as tint + border. Allows zero
 * selection. Reused by the events, payments, and activities forms.
 */
export function MemberMultiSelect({
  value,
  onChange,
  label = "Članovi",
  hint,
  people,
  emptyLabel = "Nema članova porodice.",
}: MemberMultiSelectProps) {
  const { members: family } = useFamilyMembers();
  const members = people ?? family;
  const memberEmoji = useMemberEmoji();

  const toggle = (personId: string) => {
    const set = new Set(value);
    if (set.has(personId)) set.delete(personId);
    else set.add(personId);
    // Keep the roster order so pills don't reorder as the user clicks.
    onChange(members.filter((m) => set.has(m.id)).map((m) => m.id));
  };

  return (
    <div>
      <FieldGroupLabel>{label}</FieldGroupLabel>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ChipRow role="group" aria-label={typeof label === "string" ? label : "Članovi"}>
          {members.map((person) => {
            const selected = value.includes(person.id);
            const color = person.color ?? fallbackColorForProfile(person.id);
            const name =
              getDisplayName({
                firstName: person.first_name,
                lastName: person.last_name,
                email: null,
              }) || "Bez imena";
            return (
              <Chip
                key={person.id}
                selected={selected}
                onClick={() => toggle(person.id)}
                // Member chips keep the person's own fruit colour on selection.
                style={selected ? { backgroundColor: `${color}1F`, borderColor: color } : undefined}
                className={selected ? "text-foreground" : undefined}
              >
                <span className="inline-flex items-center gap-1.5">
                  {memberEmoji(person) ? (
                    <span aria-hidden="true" className="shrink-0 text-[16px] leading-none">
                      {memberEmoji(person)}
                    </span>
                  ) : (
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{name}</span>
                </span>
              </Chip>
            );
          })}
        </ChipRow>
      )}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}
