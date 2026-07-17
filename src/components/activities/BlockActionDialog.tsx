import { useEffect, useState } from "react";
import type { ComponentType, FormEvent, SVGProps } from "react";
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ClockIcon,
  PencilSquareIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { format, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { cn } from "@/lib/cn";
import type { Activity, Profile } from "@/types/database";
import { fallbackColorForProfile, type ResolvedActivityBlock } from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";
import { useDeleteActivityOverride, useUpsertActivityOverride } from "@/hooks/useActivityOverrides";

/**
 * Per-occurrence action menu opened by clicking a block in WeekGrid.
 * Four actions:
 *
 *   • Izmeni aktivnost      → close + delegate to parent's edit-activity dialog
 *   • Otkaži ovaj termin    → switch to inline cancel form (OPTIONAL reason),
 *                             upsert override { action: 'cancel', note } on confirm
 *   • Pomeri vreme…         → switch to inline reschedule form, upsert on save
 *   • Vrati u redovan termin → delete the existing override (rescheduled or canceled)
 *
 * The dialog stays open while submitting so toast errors surface inline;
 * `onOpenChange(false)` is only called on a successful action or cancel.
 */
export type BlockActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: ResolvedActivityBlock | null;
  activity: Activity | undefined;
  person: Profile | undefined;
  onEditActivity: (activity: Activity) => void;
};

export function BlockActionDialog({
  open,
  onOpenChange,
  block,
  activity,
  person,
  onEditActivity,
}: BlockActionDialogProps) {
  const upsertOverride = useUpsertActivityOverride();
  const deleteOverride = useDeleteActivityOverride();

  // The action list is the root view; the inline cancel / reschedule forms
  // are sub-views on the sheet stack ("←" back header, dismissal returns to
  // the list). Reset when the dialog opens for a new block so stale state
  // from the previous occurrence doesn't carry over.
  const { view, atRoot, push, pop, reset, dialogOpen, dialogKey, handleOpenChange } = useSheetStack<
    "actions" | "cancel" | "reschedule"
  >(open, onOpenChange, "actions");
  useEffect(() => {
    reset();
  }, [block?.scheduleId, block?.date, reset]);

  if (!block) return null;

  const hasOverride = !!block.override;
  const overrideAction = block.override?.action;
  const isCanceled = overrideAction === "cancel";
  const isRescheduled = overrideAction === "reschedule";

  const personName = person
    ? getDisplayName({
        firstName: person.first_name,
        lastName: person.last_name,
        email: null,
      }) || "Bez imena"
    : "—";
  const color = person?.color ?? fallbackColorForProfile(block.personId);
  const dateLabel = formatBlockDate(block.date);

  const handleEdit = () => {
    if (!activity) return;
    onOpenChange(false);
    onEditActivity(activity);
  };

  // The override is always keyed by the ORIGINAL date the rule would have
  // fired on. For moved-here blocks that's `override.movedFrom`; everywhere
  // else `block.date` already equals the original.
  const originalDate = block.override?.movedFrom ?? block.date;

  const handleCancel = async (note: string | null) => {
    try {
      await upsertOverride.mutateAsync({
        schedule_id: block.scheduleId,
        person_id: block.personId,
        date: originalDate,
        action: "cancel",
        note,
      });
      onOpenChange(false);
    } catch {
      // toast surfaced by hook; keep dialog open for retry
    }
  };

  const handleRestore = async () => {
    if (!block.override) return;
    try {
      await deleteOverride.mutateAsync(block.override.id);
      onOpenChange(false);
    } catch {
      // toast surfaced by hook
    }
  };

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <SheetStackHeader
          title={
            view === "cancel"
              ? "Otkaži termin"
              : view === "reschedule"
                ? "Pomeri termin"
                : (activity?.name ?? "Aktivnost")
          }
          onBack={atRoot ? undefined : pop}
        />

        {/* Subtitle: person + occurrence date + current state (if overridden) */}
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="font-medium text-gray-900 dark:text-gray-100">{personName}</span>
          <span>·</span>
          <span>{dateLabel}</span>
        </div>

        {hasOverride ? (
          <OverrideBanner
            action={overrideAction!}
            originalDate={originalDate}
            originalStart={block.override!.originalStartTime}
            originalEnd={block.override!.originalEndTime}
            // For moved blocks we pull the target time pair from
            // rescheduledStartTime (set on the moved-away ghost) or fall
            // back to the block's own times (which are the override times
            // on moved-here / same-day reschedule).
            newDate={block.override!.movedTo ?? (block.override!.movedFrom ? block.date : null)}
            newStart={block.override!.rescheduledStartTime ?? block.startTime}
            newEnd={block.override!.rescheduledEndTime ?? block.endTime}
            note={block.override!.note}
          />
        ) : (
          <div className="mb-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
            Redovan termin:{" "}
            <span className="font-medium tabular-nums">
              {block.startTime}–{block.endTime}
            </span>
          </div>
        )}

        {view === "actions" ? (
          <ActionList
            isCanceled={isCanceled}
            isRescheduled={isRescheduled}
            saving={upsertOverride.isPending || deleteOverride.isPending}
            onEdit={handleEdit}
            onCancel={() => push("cancel")}
            onReschedule={() => push("reschedule")}
            onRestore={() => void handleRestore()}
          />
        ) : view === "cancel" ? (
          <CancelForm
            saving={upsertOverride.isPending}
            onBack={pop}
            onConfirm={(note) => void handleCancel(note)}
          />
        ) : (
          <RescheduleForm
            block={block}
            originalDate={originalDate}
            saving={upsertOverride.isPending}
            onCancel={pop}
            onSubmit={async (newDate, startTime, endTime, note) => {
              try {
                await upsertOverride.mutateAsync({
                  schedule_id: block.scheduleId,
                  person_id: block.personId,
                  date: originalDate,
                  action: "reschedule",
                  override_start_time: startTime,
                  override_end_time: endTime,
                  // Hook normalizes "same as original" to NULL.
                  override_date: newDate,
                  note: note || null,
                });
                onOpenChange(false);
              } catch {
                // toast surfaced by hook
              }
            }}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Sub-components                                                            */
/* ------------------------------------------------------------------------- */

interface ActionListProps {
  isCanceled: boolean;
  isRescheduled: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  onRestore: () => void;
}

function ActionList({
  isCanceled,
  isRescheduled,
  saving,
  onEdit,
  onCancel,
  onReschedule,
  onRestore,
}: ActionListProps) {
  const hasOverride = isCanceled || isRescheduled;

  return (
    <div className="space-y-2">
      <ActionRow
        icon={PencilSquareIcon}
        label="Izmeni aktivnost"
        description="Menja sve termine ove aktivnosti"
        onClick={onEdit}
        disabled={saving}
      />
      <ActionRow
        icon={XCircleIcon}
        label={isCanceled ? "Već je otkazan" : "Otkaži ovaj termin"}
        description="Samo ovaj jedan put — ostali ostaju"
        onClick={onCancel}
        disabled={saving || isCanceled}
      />
      <ActionRow
        icon={ClockIcon}
        label={isRescheduled ? "Promeni novo vreme" : "Pomeri vreme ovog termina…"}
        description="Samo za ovaj jedan put"
        onClick={onReschedule}
        disabled={saving}
      />
      {hasOverride ? (
        <ActionRow
          icon={ArrowUturnLeftIcon}
          label="Vrati u redovan termin"
          description={isCanceled ? "Vrati otkazan termin u raspored" : "Vrati na originalno vreme"}
          onClick={onRestore}
          disabled={saving}
          tone="muted"
        />
      ) : null}
    </div>
  );
}

interface ActionRowProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "muted";
}

function ActionRow({ icon: Icon, label, description, onClick, disabled, tone }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-left",
        "transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-gray-700 dark:hover:bg-gray-800",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          tone === "muted" ? "text-gray-500" : "text-gray-700 dark:text-gray-200",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

interface OverrideBannerProps {
  action: "cancel" | "reschedule";
  originalDate: string;
  originalStart: string;
  originalEnd: string;
  /** Non-NULL only when the reschedule moved the termin to a different day. */
  newDate: string | null;
  newStart: string;
  newEnd: string;
  note: string | null;
}

function OverrideBanner({
  action,
  originalDate,
  originalStart,
  originalEnd,
  newDate,
  newStart,
  newEnd,
  note,
}: OverrideBannerProps) {
  if (action === "cancel") {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
        <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div>
            Otkazano za ovaj dan ·{" "}
            <span className="line-through tabular-nums opacity-70">
              {originalStart}–{originalEnd}
            </span>
          </div>
          {note ? <div className="mt-0.5 text-xs opacity-80">{note}</div> : null}
        </div>
      </div>
    );
  }
  const movedToDifferentDay = newDate && newDate !== originalDate;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      <ArrowPathIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {movedToDifferentDay ? (
          <div>
            <span className="line-through opacity-70">
              {formatBlockDate(originalDate)} {originalStart}–{originalEnd}
            </span>
            <span className="mx-1.5">→</span>
            <span className="font-medium">
              {formatBlockDate(newDate as string)}{" "}
              <span className="tabular-nums">
                {newStart}–{newEnd}
              </span>
            </span>
          </div>
        ) : (
          <div>
            Pomereno na{" "}
            <span className="font-medium tabular-nums">
              {newStart}–{newEnd}
            </span>{" "}
            · ranije{" "}
            <span className="tabular-nums line-through opacity-70">
              {originalStart}–{originalEnd}
            </span>
          </div>
        )}
        {note ? <div className="mt-0.5 text-xs opacity-80">{note}</div> : null}
      </div>
    </div>
  );
}

interface CancelFormProps {
  saving: boolean;
  onBack: () => void;
  onConfirm: (note: string | null) => void;
}

/** Confirm canceling a single occurrence, with an OPTIONAL free-text reason. */
function CancelForm({ saving, onBack, onConfirm }: CancelFormProps) {
  const [note, setNote] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Otkazuje se samo ovaj termin — ostali ostaju u rasporedu.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="cancel-note">Razlog (opciono)</Label>
        <Textarea
          id="cancel-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="npr. dete bolesno"
          rows={3}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
          Nazad
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={saving}
          onClick={() => onConfirm(note.trim() || null)}
        >
          {saving ? "Čuva…" : "Otkaži termin"}
        </Button>
      </div>
    </div>
  );
}

interface RescheduleFormProps {
  block: ResolvedActivityBlock;
  /** Original date the rule would have fired on — the override's lookup key. */
  originalDate: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (
    newDate: string,
    startTime: string,
    endTime: string,
    note: string,
  ) => Promise<void> | void;
}

function RescheduleForm({ block, originalDate, saving, onCancel, onSubmit }: RescheduleFormProps) {
  // Pre-fill from the current effective state:
  //   - new (no override): original date + original times
  //   - same-day reschedule: original date + override times (= block.start/end)
  //   - moved-away ghost: target date (movedTo) + override times (rescheduled*)
  //   - moved-here block: target date (= block.date) + override times (= block.start/end)
  const defaultDate = block.override?.movedTo ?? block.date;
  const defaultStart = block.override?.rescheduledStartTime ?? block.startTime;
  const defaultEnd = block.override?.rescheduledEndTime ?? block.endTime;

  const [newDate, setNewDate] = useState<string | null>(defaultDate);
  const [startTime, setStartTime] = useState<string>(defaultStart);
  const [endTime, setEndTime] = useState<string>(defaultEnd);
  const [note, setNote] = useState<string>(block.override?.note ?? "");

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newDate || !startTime || !endTime || endTime <= startTime) return;
    void onSubmit(newDate, startTime, endTime, note.trim());
  };

  const invalid = !newDate || !startTime || !endTime || endTime <= startTime;
  const movedToDifferentDay = newDate && newDate !== originalDate;

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="reschedule-date">Datum</Label>
        <DatePicker
          id="reschedule-date"
          value={newDate}
          onChange={setNewDate}
          placeholder="Izaberi dan"
        />
        {movedToDifferentDay ? (
          <p className="text-[11px] text-muted-foreground">
            Pomereno sa <span className="font-mono">{formatBlockDate(originalDate)}</span> na{" "}
            <span className="font-mono">{formatBlockDate(newDate as string)}</span>.
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-start">Početak</Label>
          <TimePicker
            id="reschedule-start"
            value={startTime}
            onChange={(value) => setStartTime(value ?? "")}
            clearable={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-end">Kraj</Label>
          <TimePicker
            id="reschedule-end"
            value={endTime}
            onChange={(value) => setEndTime(value ?? "")}
            clearable={false}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reschedule-note">Razlog (opciono)</Label>
        <Textarea
          id="reschedule-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="npr. trener pomerio termin"
          rows={2}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Nazad
        </Button>
        <Button type="submit" disabled={saving || invalid}>
          {saving ? "Čuva…" : "Pomeri"}
        </Button>
      </div>
    </form>
  );
}

function formatBlockDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr + "T12:00:00"), "EEEE, d. MMMM", { locale: srLocale });
  } catch {
    return dateStr;
  }
}
