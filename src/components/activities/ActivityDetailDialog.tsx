import { useEffect, useMemo, useState } from "react";
import {
  BanknotesIcon,
  ClockIcon,
  PencilSquareIcon,
  SparklesIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailDeleteBody,
  DetailDeleteFooter,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import {
  LinkedMoneyChooser,
  LinkedMoneyFlow,
  type LinkedMoneyRequest,
} from "@/components/common/LinkedMoneyFlow";
import { LinkedMoneyViewer, type LinkedMoneyTarget } from "@/components/payments/LinkedMoneyViewer";
import { ActivityMoneySection } from "@/components/activities/ActivityMoneySection";
import { MemberBadges } from "@/components/common/MemberBadges";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useDeleteActivity } from "@/hooks/useActivities";
import type { Activity, ActivitySchedule } from "@/types/database";
import { DAY_LABELS_FULL, normalizeTime } from "@/utils/activity";
import { formatDate } from "@/utils/date";

/**
 * THE activity detail popup - the whole activity, not one occurrence (that's
 * `BlockActionDialog`, opened from a block on the week grid). Same shared
 * detail-sheet layout as event / payment / birthday: detalji on top (hero,
 * state badges, info rows with the termini), every action below as a visible
 * row - Izmeni, Dodaj plaćanje ili trošak, Obriši - and the linked payments +
 * expenses at the bottom, each row opening its own detail.
 *
 * Opened wherever an activity is REFERENCED rather than scheduled - today
 * that's a payment's "Povezano sa" chip (see `LinkedEntityViewer`). "Izmeni"
 * delegates the full form to the caller via `onEdit`; the money chooser and
 * the linked money detail HIDE this sheet (not close) and return here.
 */
export type ActivityDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity | null;
  onEdit: (activity: Activity) => void;
};

type View = "detail" | "money" | "delete";

/** "Ponedeljak 17:00-18:00 · svake 2 nedelje" - one line per schedule rule. */
function ruleLabel(rule: ActivitySchedule): string {
  const day = DAY_LABELS_FULL[rule.day_of_week] ?? "-";
  const time = `${normalizeTime(rule.start_time)}-${normalizeTime(rule.end_time)}`;
  const interval = Math.max(1, Math.floor(rule.recurrence_interval_weeks ?? 1));
  const cadence =
    rule.week_pattern === "A"
      ? "A nedelja (jutarnja)"
      : rule.week_pattern === "B"
        ? "B nedelja (popodnevna)"
        : interval > 1
          ? `svake ${interval} nedelje`
          : null;
  return cadence ? `${day} ${time} · ${cadence}` : `${day} ${time}`;
}

function seasonLabel(activity: Activity): string | null {
  if (!activity.active_from && !activity.active_to) return null;
  const from = activity.active_from ? formatDate(activity.active_from) : "…";
  const to = activity.active_to ? formatDate(activity.active_to) : "…";
  return `${from} - ${to}`;
}

export function ActivityDetailDialog({
  open,
  onOpenChange,
  activity,
  onEdit,
}: ActivityDetailDialogProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const deleteActivity = useDeleteActivity();
  const scheduleQuery = useActivitySchedule();
  const participantsQuery = useActivityParticipants();

  // Money-add / linked-money detail keep this sheet mounted but HIDDEN; closing
  // them brings it back with the money boxes refreshed.
  const [moneyRequest, setMoneyRequest] = useState<LinkedMoneyRequest | null>(null);
  const [moneyTarget, setMoneyTarget] = useState<LinkedMoneyTarget | null>(null);

  // Back to the root view whenever the subject activity changes underneath.
  useEffect(() => {
    reset();
  }, [activity, reset]);

  const rules = useMemo(() => {
    if (!activity) return [];
    return (scheduleQuery.data ?? [])
      .filter((rule) => rule.activity_id === activity.id)
      .toSorted(
        (a, b) =>
          a.day_of_week - b.day_of_week ||
          normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time)),
      );
  }, [scheduleQuery.data, activity]);

  const personIds = useMemo(() => {
    if (!activity) return [];
    return (participantsQuery.data ?? [])
      .filter((p) => p.activity_id === activity.id)
      .map((p) => p.person_id);
  }, [participantsQuery.data, activity]);

  const saving = deleteActivity.isPending;

  // The full edit form lives in the caller's own dialog - close and hand off.
  const handleEdit = () => {
    if (!activity) return;
    onOpenChange(false);
    onEdit(activity);
  };

  const handleDelete = async () => {
    if (!activity) return;
    try {
      await deleteActivity.mutateAsync(activity.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook; stay here so the user can retry.
    }
  };

  const statusBadges: DetailBadge[] = [];
  if (activity) {
    if (activity.is_paused) statusBadges.push({ label: "Pauzirano", tone: "warn" });
    statusBadges.push({
      label:
        rules.length === 0
          ? "Bez termina"
          : rules.length === 1
            ? "1 termin"
            : `${rules.length} termina`,
      tone: "neutral",
    });
  }
  const season = activity ? seasonLabel(activity) : null;

  const titleFor = (view: View) =>
    view === "money"
      ? "Dodaj uz aktivnost"
      : view === "delete"
        ? "Obriši aktivnost"
        : "Detalji aktivnosti";

  return (
    <>
      <SheetStackViews
        stack={stack}
        hidden={!!moneyRequest || !!moneyTarget}
        render={(view, level) => (
          <ResponsiveDialogContent>
            <SheetStackHeader
              title={titleFor(view)}
              srOnly={level === 0}
              onBack={level === 0 ? undefined : pop}
            />
            {activity ? (
              <div className="space-y-4">
                {/* Root only: a stacked sub-view sits ON TOP of this sheet,
                    which already names the subject right above it. */}
                {level === 0 ? (
                  <DetailHero
                    icon={SparklesIcon}
                    tone="accent"
                    title={activity.name}
                    titleClassName={activity.is_paused ? "text-muted-foreground" : undefined}
                    subtitle="Aktivnost"
                  />
                ) : null}

                {view === "money" ? (
                  <LinkedMoneyChooser
                    onPick={(kind) => {
                      // Hide (don't close) the sheet under the pre-linked form -
                      // it returns to the root view once the form is done.
                      reset();
                      setMoneyRequest({ kind, link: { kind: "activity", id: activity.id } });
                    }}
                  />
                ) : view === "delete" ? (
                  <DetailDeleteBody name={activity.name} note="Brišu se i svi njeni termini." />
                ) : (
                  <>
                    <DetailBadgeRow badges={statusBadges} />

                    {personIds.length > 0 ||
                    rules.length > 0 ||
                    season ||
                    activity.description ||
                    activity.notes ? (
                      <DetailInfoRows>
                        {personIds.length > 0 ? (
                          <DetailInfoRow label="Za">
                            <MemberBadges personIds={personIds} />
                          </DetailInfoRow>
                        ) : null}
                        {rules.length > 0 ? (
                          <DetailInfoRow label="Termini" icon={ClockIcon} align="baseline">
                            <span className="min-w-0 text-right font-semibold">
                              {rules.map((rule) => (
                                <span key={rule.id} className="block">
                                  {ruleLabel(rule)}
                                </span>
                              ))}
                            </span>
                          </DetailInfoRow>
                        ) : null}
                        {season ? <DetailInfoText label="Sezona" value={season} /> : null}
                        {activity.description ? (
                          <DetailInfoText label="Opis" value={activity.description} />
                        ) : null}
                        {activity.notes ? (
                          <DetailInfoText
                            label="Napomena"
                            value={activity.notes}
                            valueClassName="text-amber-700 dark:text-amber-400"
                          />
                        ) : null}
                      </DetailInfoRows>
                    ) : null}

                    <DetailActionList>
                      <DetailActionRow
                        icon={PencilSquareIcon}
                        label="Izmeni aktivnost"
                        description="Naziv, termini, učesnici, sezona…"
                        onClick={handleEdit}
                        disabled={saving}
                      />
                      <DetailActionRow
                        icon={BanknotesIcon}
                        label="Dodaj plaćanje ili trošak"
                        description="Plaćanje, trošak ili skeniran račun uz aktivnost"
                        onClick={() => push("money")}
                        disabled={saving}
                      />
                      <DetailActionRow
                        icon={TrashIcon}
                        label="Obriši aktivnost"
                        description="Trajno uklanja aktivnost i njene termine"
                        onClick={() => push("delete")}
                        disabled={saving}
                        tone="destructive"
                      />
                    </DetailActionList>

                    {/* Linked payments + expenses (render nothing without any);
                      a row opens that entry's detail over this sheet. */}
                    <ActivityMoneySection activity={activity} onSelect={setMoneyTarget} />
                  </>
                )}
              </div>
            ) : null}

            {view === "money" ? (
              <ResponsiveDialogFooter>
                <Button variant="outline" className="w-full sm:w-auto" onClick={pop}>
                  Nazad
                </Button>
              </ResponsiveDialogFooter>
            ) : view === "delete" ? (
              <DetailDeleteFooter
                deleting={saving}
                onBack={pop}
                onConfirm={() => {
                  void handleDelete();
                }}
              />
            ) : null}
          </ResponsiveDialogContent>
        )}
      />

      <LinkedMoneyFlow request={moneyRequest} onClose={() => setMoneyRequest(null)} />
      <LinkedMoneyViewer target={moneyTarget} onClose={() => setMoneyTarget(null)} />
    </>
  );
}
