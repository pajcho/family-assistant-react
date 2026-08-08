import { cn } from "@/lib/cn";
import { useMemberAvatarStyleValue } from "@/hooks/useMemberAvatarStyle";
import type { Profile } from "@/types/database";
import { fallbackColorForProfile } from "@/utils/activity";
import { getInitials } from "@/utils/identity";
import { memberTintStyle, resolveMemberAvatar, type MemberAvatarStyle } from "@/utils/memberAvatar";

/**
 * One family member as a tile - the app's single answer to "draw this person".
 *
 * Two looks, picked by the VIEWER in Podešavanja (`member_avatar_style`), never
 * by the member:
 *
 *   - `initials` (default): the person's colour filled solid, initials on top.
 *   - `emoji`: the person's emoji on a tinted wash of that same colour, with a
 *     hairline of it around the tile.
 *
 * The colour survives the switch on purpose. It is the app's oldest convention
 * and it is load-bearing elsewhere - the same hue tints this person's blocks in
 * the weekly grid and their bars in the calendar - so an emoji tile that threw
 * the colour away would break the link between a badge and the block it belongs
 * to.
 */

export { memberTintStyle };

export type MemberAvatarSize = "xs" | "sm" | "md" | "lg";

/** Everything a tile needs off a roster row; all of it optional but the id. */
export type MemberAvatarProfile = Pick<Profile, "id"> &
  Partial<Pick<Profile, "first_name" | "last_name" | "color" | "avatar_emoji">>;

export type MemberAvatarProps = {
  /** The roster row, when the caller has it. */
  member?: MemberAvatarProfile | null;
  /** Used when the row is still loading - the tile is never blank. */
  personId?: string;
  size?: MemberAvatarSize;
  /** Native tooltip. Callers pass the member's display name. */
  title?: string;
  /** Shape / ring overrides. Defaults to a circle. */
  className?: string;
  /**
   * Ignore the viewer's setting. The kid shell passes "emoji" - it is the
   * child's own app, the tiles are large, and a child reads a glyph faster
   * than two letters.
   */
  forceStyle?: MemberAvatarStyle;
};

const SIZE: Record<MemberAvatarSize, { box: string; initials: string; emoji: string }> = {
  xs: { box: "size-5", initials: "text-[9px]", emoji: "text-[13px]" },
  sm: { box: "size-6", initials: "text-[10px]", emoji: "text-[15px]" },
  md: { box: "size-[38px]", initials: "text-[13px]", emoji: "text-[23px]" },
  lg: { box: "size-12", initials: "text-base", emoji: "text-[29px]" },
};

export function MemberAvatar({
  member,
  personId,
  size = "sm",
  title,
  className,
  forceStyle,
}: MemberAvatarProps) {
  const viewerStyle = useMemberAvatarStyleValue();
  const style = forceStyle ?? viewerStyle;

  const id = member?.id ?? personId ?? "";
  const color = member?.color ?? fallbackColorForProfile(id);
  const sizing = SIZE[size];

  // With a title the tile IS the person on screen (the overlapping badges on an
  // agenda row carry no name next to them), so it announces the name - never
  // the initials, which read as "em pe". Without one the name is already
  // written beside it and the tile is pure decoration.
  const semantics = title
    ? ({ role: "img", "aria-label": title, title } as const)
    : ({ "aria-hidden": true } as const);

  if (style === "emoji") {
    return (
      <span
        {...semantics}
        style={memberTintStyle(color)}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border-[1.5px] leading-none",
          sizing.box,
          sizing.emoji,
          className,
        )}
      >
        <span aria-hidden="true">{resolveMemberAvatar(member, personId)}</span>
      </span>
    );
  }

  return (
    <span
      {...semantics}
      style={{ backgroundColor: color }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        sizing.box,
        sizing.initials,
        className,
      )}
    >
      <span aria-hidden="true">
        {getInitials({
          firstName: member?.first_name ?? null,
          lastName: member?.last_name ?? null,
          email: null,
        })}
      </span>
    </span>
  );
}
