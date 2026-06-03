import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

export type MemberMultiSelectProps = {
  /** Selected person ids. */
  value: string[];
  onChange: (personIds: string[]) => void;
  label?: string;
  /** Helper line under the pills (e.g. "opciono"). */
  hint?: string;
};

/**
 * Inline toggle pills for assigning an event / payment to one or more people.
 * Self-fetches the roster; the parent owns only the selected ids. Compact
 * (wraps, no bordered box) and matches the `PersonChip` filter style — a
 * selected pill gets the person's color as tint + border. Allows zero
 * selection. Reused by payments in Phase 2.
 */
export function MemberMultiSelect({
  value,
  onChange,
  label = "Članovi",
  hint,
}: MemberMultiSelectProps) {
  const { members } = useFamilyMembers();

  const toggle = (personId: string) => {
    const set = new Set(value);
    if (set.has(personId)) set.delete(personId);
    else set.add(personId);
    // Keep the roster order so pills don't reorder as the user clicks.
    onChange(members.filter((m) => set.has(m.id)).map((m) => m.id));
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nema članova porodice.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
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
              <button
                type="button"
                key={person.id}
                onClick={() => toggle(person.id)}
                aria-pressed={selected}
                style={selected ? { backgroundColor: `${color}1F`, borderColor: color } : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  selected
                    ? "text-gray-900 dark:text-gray-100"
                    : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                )}
              >
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="truncate">{name}</span>
              </button>
            );
          })}
        </div>
      )}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
