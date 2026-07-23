import { useMemo, useState } from "react";

import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog";
import type { ActivityFormPayload } from "@/components/activities/ActivityForm";
import { useCreateActivity } from "@/hooks/useActivities";
import { useReplaceActivityParticipants } from "@/hooks/useActivityParticipants";
import { useReplaceActivitySchedule } from "@/hooks/useActivitySchedule";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";

/**
 * Self-contained "add activity" dialog - owns the roster, shift anchors and the
 * three-write create flow (activity + schedule rules + participants) that
 * otherwise lives in the /activities page. Lets the dashboard's "Dodaj" menu
 * offer Aktivnost alongside Događaj / Plaćanje / Rođendan without duplicating the
 * wiring at the call site: the parent only flips `open`.
 */
export function ActivityAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { profile } = useProfile();
  const { members } = useFamilyMembers();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();

  const createActivity = useCreateActivity();
  const replaceSchedule = useReplaceActivitySchedule();
  const replaceParticipants = useReplaceActivityParticipants();

  const [error, setError] = useState<string | null>(null);

  // A/B week patterns only matter for children whose rota actually alternates -
  // mirrors the /activities page derivation.
  const peopleWithShift = useMemo(() => {
    const set = new Set<string>();
    for (const [personId, anchor] of anchorsByPersonId) {
      if (anchor.is_alternating) set.add(personId);
    }
    return set;
  }, [anchorsByPersonId]);

  const saving =
    createActivity.isPending || replaceSchedule.isPending || replaceParticipants.isPending;

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setError(null);
  };

  const handleSubmit = async (payload: ActivityFormPayload) => {
    setError(null);
    try {
      const { rules, person_ids, ...activityPayload } = payload;
      const created = await createActivity.mutateAsync(activityPayload);
      await replaceSchedule.mutateAsync({ activityId: created.id, rules });
      await replaceParticipants.mutateAsync({ activityId: created.id, personIds: person_ids });
      handleOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : "Greška pri kreiranju aktivnosti",
      );
    }
  };

  return (
    <ActivityFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      activity={null}
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
