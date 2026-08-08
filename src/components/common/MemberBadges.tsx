import { MemberAvatar } from "@/components/common/MemberAvatar";
import { cn } from "@/lib/cn";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { getDisplayName } from "@/utils/identity";

export type MemberBadgesProps = {
  personIds: string[];
  /** Cap the rendered circles; the rest collapse into a "+N" chip. */
  max?: number;
  size?: "xs" | "sm";
  className?: string;
};

const OVERFLOW_SIZE_CLASS: Record<NonNullable<MemberBadgesProps["size"]>, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
};

/**
 * Read-only row of assigned family members as overlapping tiles - initials or
 * emoji, whichever the viewer picked (see {@link MemberAvatar}). Self-fetches
 * the roster (TanStack Query dedupes the shared key), so callers pass only the
 * ids. Renders nothing when there are no assignees.
 */
export function MemberBadges({ personIds, max = 4, size = "sm", className }: MemberBadgesProps) {
  const { byId } = useFamilyMembers();
  if (personIds.length === 0) return null;

  const shown = personIds.slice(0, max);
  const overflow = personIds.length - shown.length;

  return (
    <div className={cn("flex items-center -space-x-1.5", className)}>
      {shown.map((id) => {
        const person = byId.get(id);
        const name =
          getDisplayName({
            firstName: person?.first_name ?? null,
            lastName: person?.last_name ?? null,
            email: null,
          }) || "Član";
        return (
          <MemberAvatar
            key={id}
            member={person}
            personId={id}
            size={size}
            title={name}
            className="ring-2 ring-card"
          />
        );
      })}
      {overflow > 0 ? (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-card",
            OVERFLOW_SIZE_CLASS[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
