import { cn } from "@/lib/cn";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName, getInitials } from "@/utils/identity";

export type MemberBadgesProps = {
  personIds: string[];
  /** Cap the rendered circles; the rest collapse into a "+N" chip. */
  max?: number;
  size?: "xs" | "sm";
  className?: string;
};

const SIZE_CLASS: Record<NonNullable<MemberBadgesProps["size"]>, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
};

/**
 * Read-only row of assigned family members as overlapping colored initials.
 * Self-fetches the roster (TanStack Query dedupes the shared key), so callers
 * pass only the ids. Renders nothing when there are no assignees.
 */
export function MemberBadges({ personIds, max = 4, size = "sm", className }: MemberBadgesProps) {
  const { byId } = useFamilyMembers();
  if (personIds.length === 0) return null;

  const shown = personIds.slice(0, max);
  const overflow = personIds.length - shown.length;
  const sizeClass = SIZE_CLASS[size];

  return (
    <div className={cn("flex items-center -space-x-1.5", className)}>
      {shown.map((id) => {
        const person = byId.get(id);
        const color = person?.color ?? fallbackColorForProfile(id);
        const identity = {
          firstName: person?.first_name ?? null,
          lastName: person?.last_name ?? null,
          email: null,
        };
        const name = getDisplayName(identity) || "Član";
        return (
          <span
            key={id}
            title={name}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full font-medium text-white ring-2 ring-white dark:ring-gray-800",
              sizeClass,
            )}
            style={{ backgroundColor: color }}
          >
            {getInitials(identity)}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-gray-300 font-medium text-gray-700 ring-2 ring-white dark:bg-gray-600 dark:text-gray-200 dark:ring-gray-800",
            sizeClass,
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
