import { cn } from "@/lib/cn";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName, getInitials } from "@/utils/identity";

/**
 * The Danas person filter: a "Svi" chip plus one 26px avatar ring per member.
 *
 * A ring (tinted fill, colored border) rather than a solid avatar, so the row
 * reads as a filter control and not as "these people are here". Selecting one
 * fills it with that person's colour - the same colour their rows carry in the
 * timeline, which is what makes the connection obvious without a legend.
 *
 * The filter SEMANTICS are unchanged: this drives the same
 * `filter.personIds` set the agenda has always used (birthdays stay exempt -
 * see `matchesAgendaFilter`).
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
  if (members.length === 0) return null;

  const noneSelected = selected.size === 0;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
      <button
        type="button"
        onClick={onClear}
        aria-pressed={noneSelected}
        className={cn(
          "flex-none rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition-colors",
          noneSelected
            ? "border-accent bg-accent text-accent-foreground"
            : "border-border bg-card text-muted-foreground",
        )}
      >
        Svi
      </button>
      {members.map((member) => {
        const color = member.color ?? fallbackColorForProfile(member.id);
        const name =
          getDisplayName({
            firstName: member.first_name,
            lastName: member.last_name,
            email: null,
          }) || "Bez imena";
        const on = selected.has(member.id);
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => onToggle(member.id)}
            aria-pressed={on}
            aria-label={`Filtriraj: ${name}`}
            title={name}
            className={cn(
              "grid size-[26px] flex-none place-items-center rounded-full border-[1.5px] text-[10px] font-extrabold transition-[opacity,filter]",
              !on && !noneSelected && "opacity-40 saturate-50",
            )}
            style={
              on
                ? { background: color, borderColor: color, color: "#fff" }
                : {
                    background: `color-mix(in srgb, ${color} 13%, var(--card))`,
                    borderColor: `color-mix(in srgb, ${color} 42%, transparent)`,
                    color,
                  }
            }
          >
            {getInitials({
              firstName: member.first_name,
              lastName: member.last_name,
              email: null,
            })}
          </button>
        );
      })}
    </div>
  );
}
