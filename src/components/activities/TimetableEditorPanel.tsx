import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type {
  BellSchedule,
  Profile,
  SchoolShift,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
  TimetableVariant,
} from "@/types/database";
import { DAY_LABELS_FULL, SHIFT_LABELS } from "@/utils/activity";
import { computeBellGrid, variantForShift } from "@/utils/schoolTimetable";
import { useReplaceTimetableDay } from "@/hooks/useSchoolTimetable";

/** Weekdays the editor exposes (Mon–Fri). Saturday/Sunday rarely have classes. */
const SCHOOL_DAYS = [0, 1, 2, 3, 4] as const;

/** Which bell-schedule band a variant resolves to for this child. */
function bandForVariant(
  anchor: SchoolShiftAnchor | undefined,
  variant: TimetableVariant,
): SchoolShift {
  if (anchor?.fixed_time_band) return anchor.fixed_time_band;
  return variant === "A" ? "morning" : "afternoon";
}

export type TimetableEditorPanelProps = {
  member: Profile;
  anchor: SchoolShiftAnchor | undefined;
  /** All family timetable entries — filtered to this member internally. */
  entries: ReadonlyArray<SchoolTimetableEntry>;
  bell: BellSchedule;
  /** Optional "done" action (closes the dialog / returns to the options hub). */
  onDone?: () => void;
};

/**
 * Fast subject entry body — type subjects one per line, times derived live
 * from the bell schedule. Headerless so it can render inside a dialog or
 * inside the options sheet.
 *
 * Persistence: each (variant, day) column is replaced as a unit. The current
 * column is saved when switching variant/day, on explicit save, and — crucially
 * for the in-sheet flow — on unmount (i.e. when the user navigates back or
 * closes), so typed-but-not-saved edits aren't lost.
 */
export function TimetableEditorPanel({
  member,
  anchor,
  entries,
  bell,
  onDone,
}: TimetableEditorPanelProps) {
  const replace = useReplaceTimetableDay();

  const showVariantTabs = !!anchor && anchor.is_alternating;
  const singleVariant: TimetableVariant =
    anchor && !anchor.is_alternating ? variantForShift(anchor.anchor_shift) : "A";

  const [variant, setVariant] = React.useState<TimetableVariant>(singleVariant);
  const [day, setDay] = React.useState<number>(0);
  const [text, setText] = React.useState<string>("");

  // Freshest member entries, read via ref inside the load effect so realtime
  // refreshes don't clobber the textarea mid-edit.
  const memberEntries = React.useMemo(
    () => entries.filter((e) => e.person_id === member.id),
    [entries, member.id],
  );
  const entriesRef = React.useRef(memberEntries);
  entriesRef.current = memberEntries;

  const textFor = React.useCallback((v: TimetableVariant, d: number): string => {
    return entriesRef.current
      .filter((e) => e.variant === v && e.day_of_week === d)
      .slice()
      .sort((a, b) => a.period_index - b.period_index)
      .map((e) => e.subject)
      .join("\n");
  }, []);

  // Baseline text for the current column, to detect whether there's anything
  // to persist.
  const loadedRef = React.useRef<string>("");

  // Reset to the default variant/day when the child (alternation) changes.
  React.useEffect(() => {
    setVariant(singleVariant);
    setDay(0);
  }, [singleVariant]);

  // Load the column's text whenever the selection changes (and on mount).
  React.useEffect(() => {
    const t = textFor(variant, day);
    setText(t);
    loadedRef.current = t;
  }, [variant, day, textFor]);

  // Serialize saves through a single chain so overlapping triggers can't fire
  // two delete+insert pairs for the same column. Tapping "Sačuvaj"/"Gotovo"
  // first blurs the textarea (→ onBlur persist) and then runs the button
  // handler (→ persist); run concurrently, the second INSERT raced the first
  // and tripped the (person, variant, day, period) unique constraint. Chained,
  // the second run sees `text === loadedRef.current` and no-ops.
  const saveChainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const persistCurrent = React.useCallback((): Promise<void> => {
    const run = async () => {
      if (text === loadedRef.current) return;
      const subjects = text
        .split("\n")
        .map((s) => ({ subject: s }))
        .filter((s) => s.subject.trim().length > 0);
      await replace.mutateAsync({ personId: member.id, variant, dayOfWeek: day, subjects });
      loadedRef.current = text;
    };
    const next = saveChainRef.current.then(run, run);
    // Keep the stored link non-rejecting so a failed save doesn't wedge the
    // queue; callers still get the real (awaitable) promise back.
    saveChainRef.current = next.catch(() => {});
    return next;
  }, [text, replace, member.id, variant, day]);

  // Flush pending edits on unmount — covers "navigate back" / "close" without
  // an explicit save. Uses a ref so the cleanup sees the latest closure.
  const persistRef = React.useRef(persistCurrent);
  persistRef.current = persistCurrent;
  React.useEffect(() => () => void persistRef.current().catch(() => {}), []);

  const switchVariant = async (v: TimetableVariant) => {
    if (v === variant) return;
    await persistCurrent().catch(() => {});
    setVariant(v);
  };
  const switchDay = async (d: number) => {
    if (d === day) return;
    await persistCurrent().catch(() => {});
    setDay(d);
  };

  const handleSave = async () => {
    await persistCurrent();
    toast.success("Raspored sačuvan");
  };
  const handleDone = async () => {
    await persistCurrent().catch(() => {});
    onDone?.();
  };

  const band = bandForVariant(anchor, variant);
  const usesPredcas = anchor?.afternoon_uses_predcas ?? false;
  const grid = React.useMemo(
    () => computeBellGrid(bell, band, usesPredcas),
    [bell, band, usesPredcas],
  );

  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Upiši predmete redom, jedan po liniji. Vremena se računaju automatski iz satnice zvona.
      </p>

      {!anchor ? (
        <div className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Ovo dete nema postavljenu smenu — raspored se prikazuje kao jutarnji (nedelja A). Postavi
          smenu da bi se A/B i popodne računali ispravno.
        </div>
      ) : null}

      {/* Variant selector — only for children whose shift rotates. */}
      {showVariantTabs ? (
        <div className="space-y-1.5">
          <Label>Nedelja</Label>
          <div className="flex gap-2">
            {(["A", "B"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => void switchVariant(v)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  variant === v
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800",
                )}
              >
                Nedelja {v}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {SHIFT_LABELS[bandForVariant(anchor, v)]}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {SHIFT_LABELS[band]} · isti raspored svake nedelje
        </p>
      )}

      {/* Day selector */}
      <div className="space-y-1.5">
        <Label>Dan</Label>
        <div className="flex flex-wrap gap-1.5">
          {SCHOOL_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => void switchDay(d)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                day === d
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                  : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800",
              )}
            >
              {DAY_LABELS_FULL[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Subjects + live preview */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`subjects-${member.id}`}>Predmeti (jedan po liniji)</Label>
          <Textarea
            id={`subjects-${member.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void persistCurrent().catch(() => {})}
            rows={8}
            placeholder={"Srpski\nMatematika\nPriroda i društvo\nFizičko\nLikovno"}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Pregled vremena</Label>
          <div className="rounded-md border border-gray-200 p-2 text-sm dark:border-gray-700">
            {lines.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Upiši predmete da vidiš vremena.
              </p>
            ) : (
              <ol className="space-y-0.5">
                {lines.map((subject, i) => {
                  const slot = grid[i];
                  return (
                    <React.Fragment key={`${i}-${subject}`}>
                      <li className="flex items-baseline justify-between gap-2">
                        <span className="truncate">
                          <span className="mr-1 tabular-nums text-muted-foreground">{i + 1}.</span>
                          {subject}
                        </span>
                        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                          {slot ? `${slot.startTime}–${slot.endTime}` : "van satnice"}
                        </span>
                      </li>
                      {slot?.bigBreakAfter ? (
                        <li className="py-0.5 text-center text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          — veliki odmor —
                        </li>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant={onDone ? "ghost" : "default"}
          onClick={() => void handleSave()}
          disabled={replace.isPending}
        >
          Sačuvaj
        </Button>
        {onDone ? (
          <Button type="button" onClick={() => void handleDone()} disabled={replace.isPending}>
            Gotovo
          </Button>
        ) : null}
      </div>
    </div>
  );
}
