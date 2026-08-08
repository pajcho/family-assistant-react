import { useMemo, useState } from "react";

import { KidDetailSheet } from "@/components/kid/KidSheet";
import {
  KidCard,
  KidCardMain,
  KidCardMeta,
  KidCardSide,
  KidCardTitle,
  KidTag,
  KidTile,
} from "@/components/kid/KidUi";
import { ageOnOccurrence } from "@/components/kid/kidAgendaModel";
import { countdownLabel, formatKidLongDate } from "@/components/kid/kidCopy";
import type { KidBirthdayVisibility } from "@/components/kid/useKidBirthdayVisibility";
import type { Birthday, Profile } from "@/types/database";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { resolveMemberAvatar } from "@/utils/memberAvatar";
import { daysUntilBirthday, nextBirthdayDate } from "@/utils/birthday";

/**
 * Porodica - who is in the family, and whose birthday is next.
 *
 * Purely a read: no member is tappable into anything editable, and the only
 * thing that opens is a birthday's detail sheet (where the parent's note for
 * THIS child lives). The birthdays a child sees are exactly the ones a parent
 * ticked for them - enforced BOTH by `birthday_visibility` in RLS and, in
 * `useKidBirthdayEntries` below, in code (see that hook for why).
 */

/** A safe 6-digit-hex tint, or nothing. Profile colours are hex by contract. */
function tint(color: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}24` : undefined;
}

export function KidFamilyGrid({
  members,
  meProfileId,
}: {
  members: ReadonlyArray<Profile>;
  meProfileId: string | null;
}) {
  return (
    <ul className="mb-1.5 grid list-none grid-cols-2 gap-2.5">
      {members.map((member) => {
        const color = member.color ?? fallbackColorForProfile(member.id);
        const name =
          member.first_name ||
          getDisplayName({
            firstName: member.first_name,
            lastName: member.last_name,
            email: null,
          }) ||
          "Član porodice";
        return (
          <li
            key={member.id}
            className="rounded-[20px] border-[1.5px] border-[var(--k-line)] bg-[var(--k-card)] px-2.5 pt-4 pb-3.5 text-center shadow-[var(--k-shadow)]"
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: tint(color) }}
              className="mx-auto grid size-[58px] place-items-center rounded-[20px] text-[34px] leading-none"
            >
              {resolveMemberAvatar(member)}
            </span>
            <p className="mt-2 text-[14.5px] font-semibold text-[var(--k-ink)]">{name}</p>
            {member.id === meProfileId ? (
              <span className="mt-1.5 inline-block rounded-full bg-[var(--k-soft)] px-2.5 py-0.5 text-[10.5px] font-medium text-[var(--k-accent)]">
                ⭐ to si ti
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Birthdays
// ---------------------------------------------------------------------------

interface KidBirthdayEntry {
  birthday: Birthday;
  /** Next occurrence, `YYYY-MM-DD`. */
  dateISO: string;
  days: number;
  note: string | null;
}

/**
 * The next birthdays this child was told about, soonest first.
 *
 * `birthdays` arrives straight from `useBirthdaysList()`, which returns
 * whatever the SESSION may read - the ticked rows under a kid session, the
 * whole family under a parent's (which is what the preview runs on). So the
 * visible set is applied here rather than left to RLS: same code path for a
 * real child and for a previewing parent, and a real child keeps the policy as
 * a second line of defence instead of the only one.
 *
 * `todayISO` is threaded through only so the list recomputes when the day rolls
 * over under a suspended PWA.
 */
export function useKidBirthdayEntries(
  birthdays: ReadonlyArray<Birthday>,
  visibility: KidBirthdayVisibility,
  todayISO: string,
  limit = 6,
): KidBirthdayEntry[] {
  const { visibleIds, notes } = visibility;
  return useMemo(() => {
    void todayISO;
    return birthdays
      .filter((birthday) => visibleIds.has(birthday.id))
      .map((birthday) => {
        const next = nextBirthdayDate(birthday.birth_date);
        const dateISO = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
          next.getDate(),
        ).padStart(2, "0")}`;
        return {
          birthday,
          dateISO,
          days: daysUntilBirthday(birthday.birth_date),
          note: notes.get(birthday.id) ?? null,
        };
      })
      .sort((a, b) => a.days - b.days)
      .slice(0, limit);
  }, [birthdays, visibleIds, notes, todayISO, limit]);
}

/** Beyond this the day count stops being meaningful and the date takes over. */
const COUNTDOWN_HORIZON_DAYS = 45;

export function KidBirthdayList({ entries }: { entries: ReadonlyArray<KidBirthdayEntry> }) {
  const [open, setOpen] = useState<KidBirthdayEntry | null>(null);

  return (
    <>
      {entries.map((entry) => (
        <KidCard
          key={entry.birthday.id}
          onClick={() => setOpen(entry)}
          ariaLabel={`${entry.birthday.name} - otvori detalje`}
        >
          <KidTile emoji={entry.days <= 1 ? "🎈" : "🎂"} />
          <KidCardMain>
            <KidCardTitle>{entry.birthday.name}</KidCardTitle>
            {/* The date always stays: past the countdown horizon the chip is
                gone, so this line is the only thing telling the child WHEN. A
                parent's note is extra, on its own line, never a replacement. */}
            <KidCardMeta>{formatKidLongDate(entry.dateISO)}</KidCardMeta>
            {entry.note ? (
              <span className="text-[12.5px] font-semibold text-[var(--k-accent-strong)]">
                💌 {entry.note}
              </span>
            ) : null}
          </KidCardMain>
          <KidCardSide>
            {/* A countdown only while it still means something. "za 362 dana"
                is not a number a child can feel - past ~six weeks the date in
                the meta line says more, so the chip simply steps aside. */}
            {entry.days <= COUNTDOWN_HORIZON_DAYS ? (
              <KidTag tone="birthday">{countdownLabel(entry.days)}</KidTag>
            ) : null}
          </KidCardSide>
        </KidCard>
      ))}

      {open ? (
        <KidDetailSheet
          open
          onClose={() => setOpen(null)}
          emoji="🎂"
          title={open.birthday.name}
          rows={birthdayDetailRows(open)}
        />
      ) : null}
    </>
  );
}

function birthdayDetailRows(entry: KidBirthdayEntry): { icon: string; text: string }[] {
  const rows: { icon: string; text: string }[] = [];
  const long = formatKidLongDate(entry.dateISO);
  rows.push({ icon: "📅", text: long.charAt(0).toUpperCase() + long.slice(1) });
  const age = ageOnOccurrence(entry.birthday.birth_date, entry.dateISO);
  if (age) rows.push({ icon: "🎂", text: `Puni ${age} godina` });
  const countdown = countdownLabel(entry.days);
  rows.push({ icon: "⏳", text: countdown.charAt(0).toUpperCase() + countdown.slice(1) });
  const description = entry.birthday.description?.trim();
  if (description) rows.push({ icon: "📝", text: description });
  if (entry.note) rows.push({ icon: "💌", text: `Za tebe: ${entry.note}` });
  return rows;
}
