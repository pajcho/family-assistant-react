import {
  ComputerDesktopIcon,
  FaceSmileIcon,
  MoonIcon,
  SunIcon,
  SwatchIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/24/solid";

import { cn } from "@/lib/cn";
import { ACCENT_OPTIONS, useAccent, type AccentKey } from "@/hooks/useAccent";
import { useMemberAvatarStyle } from "@/hooks/useMemberAvatarStyle";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import type { MemberAvatarStyle } from "@/utils/memberAvatar";

/**
 * "Izgled", "Boja aplikacije" and "Prikaz članova" - the rows of the Aplikacija
 * group that carry their control inline instead of pushing to a sub-screen.
 *
 * All three are per user and apply everywhere INSIDE the app; the brand outside
 * it (login mark, PWA icon, splash) stays blue on purpose, which the hint under
 * the accent picker says out loud.
 */

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string; icon: typeof SunIcon }> = [
  { value: "light", label: "Svetla", icon: SunIcon },
  { value: "dark", label: "Tamna", icon: MoonIcon },
  { value: "auto", label: "Auto", icon: ComputerDesktopIcon },
];

export function ThemeRow() {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex min-h-[52px] flex-wrap items-center gap-x-[11px] gap-y-2 border-b border-border px-[13px] py-3 last:border-b-0">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
        <MoonIcon className="size-[17px]" />
      </span>
      <span className="flex-1 text-[14.5px] font-semibold">Izgled</span>
      <div
        role="radiogroup"
        aria-label="Tema"
        className="flex gap-0.5 rounded-md border border-border bg-background p-[3px]"
      >
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
              mode === value ? "bg-accent-soft text-accent-deep" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const MEMBER_AVATAR_OPTIONS: ReadonlyArray<{
  value: MemberAvatarStyle;
  label: string;
  icon: typeof SunIcon;
}> = [
  { value: "initials", label: "Inicijali i boje", icon: UserCircleIcon },
  { value: "emoji", label: "Emoji", icon: FaceSmileIcon },
];

/**
 * "Prikaz članova" - initials on a colour, or each member's emoji.
 *
 * A viewer's setting, not a member's: the emoji itself belongs to the person
 * and is picked in Porodica, while this row only says whether I want to SEE it.
 * Per user like the accent, so two parents on one family need not agree.
 *
 * Same segmented control as "Izgled" because it is the same kind of choice -
 * one of a short list of looks, applied live. The colour survives either way:
 * an emoji tile still wears the member's colour as its wash, so the link to
 * their blocks in the calendar holds.
 */
export function MemberAvatarStyleRow() {
  const { memberAvatarStyle, setMemberAvatarStyle } = useMemberAvatarStyle();

  return (
    <div className="border-b border-border px-[13px] py-3 last:border-b-0">
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-[11px] gap-y-2">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
          <UserCircleIcon className="size-[17px]" />
        </span>
        <span className="flex-1 text-[14.5px] font-semibold">Prikaz članova</span>
        <div
          role="radiogroup"
          aria-label="Prikaz članova"
          className="flex gap-0.5 rounded-md border border-border bg-background p-[3px]"
        >
          {MEMBER_AVATAR_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={memberAvatarStyle === value}
              onClick={() => setMemberAvatarStyle(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
                memberAvatarStyle === value
                  ? "bg-accent-soft text-accent-deep"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs font-normal text-muted-foreground">
        Emoji za svakog člana biraš u Porodici. Dečija aplikacija uvek prikazuje emoji.
      </p>
    </div>
  );
}

export function AccentRow() {
  const { accent, setAccent } = useAccent();

  return (
    <div className="border-b border-border px-[13px] py-3 last:border-b-0">
      {/* Swatches inline with the title, the same shape as a member's colour
          picker: four colours need no labels next to them, and a labelled
          button each turned one setting into a block of four cards. Wraps to
          its own line on narrow phones. */}
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-[11px] gap-y-2">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
          <SwatchIcon className="size-[17px]" />
        </span>
        <span className="flex-1 text-[14.5px] font-semibold">Boja aplikacije</span>
        <div role="radiogroup" aria-label="Boja aplikacije" className="flex items-center gap-0.5">
          {ACCENT_OPTIONS.map((option) => (
            <AccentSwatch
              key={option.key}
              optionKey={option.key}
              label={option.label}
              swatch={option.swatch}
              selected={accent === option.key}
              onSelect={() => setAccent(option.key)}
            />
          ))}
        </div>
      </div>
      <p className="text-xs font-normal text-muted-foreground">
        Lični akcenat - važi samo za tebe, na svim uređajima. Prijava i ikonica aplikacije ostaju
        plavi.
      </p>
    </div>
  );
}

function AccentSwatch({
  optionKey,
  label,
  swatch,
  selected,
  onSelect,
}: {
  optionKey: AccentKey;
  label: string;
  swatch: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      data-accent-option={optionKey}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full border-2 transition-transform",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected ? "border-foreground" : "border-transparent hover:scale-110",
      )}
    >
      <span
        className="grid size-7 place-items-center rounded-full"
        style={{ backgroundColor: swatch }}
        aria-hidden="true"
      >
        {selected ? <CheckIcon className="size-4 text-white" /> : null}
      </span>
    </button>
  );
}
