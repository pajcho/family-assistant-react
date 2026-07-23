import { useMemo, useState } from "react";

import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog";
import type { ActivityFormPayload } from "@/components/activities/ActivityForm";
import { useUpdateActivity } from "@/hooks/useActivities";
import {
  useActivityParticipants,
  useReplaceActivityParticipants,
} from "@/hooks/useActivityParticipants";
import { useActivitySchedule, useReplaceActivitySchedule } from "@/hooks/useActivitySchedule";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import type { Activity } from "@/types/database";

/**
 * Self-contained "edit activity" dialog - the edit counterpart of
 * `ActivityAddDialog`. Owns the roster, shift anchors, the activity's existing
 * termini + učesnici (prefill), and the three-write update flow (activity +
 * schedule rules + participants). Lets the dashboard's agenda detail popups open
 * the full edit form INLINE instead of deep-linking to /activities - the
 * schedule/participants queries are already warm in the cache there (`useAgenda`
 * loads them), so there's no extra fetch and the form opens prefilled at once.
 */
export function ActivityEditDialog({
  activity,
  open,
  onOpenChange,
}: {
  activity: Activity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { profile } = useProfile();
  const { members } = useFamilyMembers();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();
  const scheduleQuery = useActivitySchedule();
  const participantsQuery = useActivityParticipants();

  const updateActivity = useUpdateActivity();
  const replaceSchedule = useReplaceActivitySchedule();
  const replaceParticipants = useReplaceActivityParticipants();

  const [error, setError] = useState<string | null>(null);

  // A/B week patterns only matter for children whose rota actually alternates -
  // mirrors the /activities page + ActivityAddDialog derivation.
  const peopleWithShift = useMemo(() => {
    const set = new Set<string>();
    for (const [personId, anchor] of anchorsByPersonId) {
      if (anchor.is_alternating) set.add(personId);
    }
    return set;
  }, [anchorsByPersonId]);

  // Prefill the form with this activity's termini + učesnici (from the warm
  // wholesale queries the dashboard already loaded).
  const existingRules = useMemo(
    () =>
      activity ? (scheduleQuery.data ?? []).filter((rule) => rule.activity_id === activity.id) : [],
    [scheduleQuery.data, activity],
  );
  const existingPersonIds = useMemo(
    () =>
      activity
        ? (participantsQuery.data ?? [])
            .filter((p) => p.activity_id === activity.id)
            .map((p) => p.person_id)
        : [],
    [participantsQuery.data, activity],
  );

  const saving =
    updateActivity.isPending || replaceSchedule.isPending || replaceParticipants.isPending;

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setError(null);
  };

  const handleSubmit = async (payload: ActivityFormPayload) => {
    if (!activity) return;
    setError(null);
    try {
      const { rules, person_ids, ...activityPayload } = payload;
      await updateActivity.mutateAsync({ id: activity.id, payload: activityPayload });
      await replaceSchedule.mutateAsync({ activityId: activity.id, rules });
      await replaceParticipants.mutateAsync({ activityId: activity.id, personIds: person_ids });
      handleOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : "Greška pri ažuriranju aktivnosti",
      );
    }
  };

  return (
    <ActivityFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      activity={activity}
      existingRules={existingRules}
      existingPersonIds={existingPersonIds}
      people={members}
      peopleWithShift={peopleWithShift}
      defaultPersonId={profile?.id ?? null}
      error={error}
      saving={saving}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}
