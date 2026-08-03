import { useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, GlobeAltIcon, MapPinIcon } from "@heroicons/react/24/outline";

import { Label } from "@/components/ui/label";
import { EVENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  DetailActionList,
  DetailActionRow,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
} from "@/components/common/DetailSheet";
import { MemberBadges } from "@/components/common/MemberBadges";
import { useExternalEventLocal } from "@/hooks/useExternalEventLocal";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import type { ExternalCalendarEvent, Profile } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { formatDate } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";

/**
 * Read-only detail popup for a mirrored Google event (opened from the agenda via
 * `useAgendaDetails`) - the shared detail-sheet layout (hero, info rows, action
 * row). Mirrored events are never editable in the app - the only Google action
 * is "Otvori u Google" / "Otvori email" (the source link). On top we allow
 * APP-LOCAL enrichment (kept in external_event_local, not pushed to Google):
 * assign to a family member + set a family push reminder.
 */
export type ExternalEventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ExternalCalendarEvent | null;
};

function timeRangeLabel(event: ExternalCalendarEvent): string {
  if (event.is_all_day || !event.start_time) return "Ceo dan";
  const start = normalizeTime(event.start_time);
  const end = event.end_time ? normalizeTime(event.end_time) : null;
  return end ? `${start}-${end}` : start;
}

/** Google Maps "search" deep link for a free-text location - opens the Maps app
 *  on mobile, maps.google.com on desktop. */
function mapsSearchUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function PersonAssignSelect({
  id,
  members,
  value,
  onChange,
}: {
  id: string;
  members: Profile[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-9 w-44 cursor-pointer rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
    >
      <option value="">Niko</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {getDisplayName({ firstName: m.first_name, lastName: m.last_name, email: null }) ||
            "Bez imena"}
        </option>
      ))}
    </select>
  );
}

export function ExternalEventDetailDialog({
  open,
  onOpenChange,
  event,
}: ExternalEventDetailDialogProps) {
  const { members } = useFamilyMembers();
  const { setLocal } = useExternalEventLocal();

  // Local control state, seeded from the (already-merged) event. Persisted on
  // change via external_event_local, keyed by the stable ical_uid.
  const [assigned, setAssigned] = useState<string | null>(null);
  const [remind, setRemind] = useState<number | null>(null);
  useEffect(() => {
    setAssigned(event?.assigned_person_id ?? null);
    setRemind(event?.remind_minutes_before ?? null);
  }, [event]);

  const onAssign = (personId: string | null) => {
    setAssigned(personId);
    if (event?.ical_uid) setLocal({ icalUid: event.ical_uid, assignedPersonId: personId });
  };
  const onRemind = (minutes: number | null) => {
    setRemind(minutes);
    if (event?.ical_uid) setLocal({ icalUid: event.ical_uid, remindMinutesBefore: minutes });
  };

  // fromGmail events carry a useless boilerplate description; link to the source
  // Gmail message instead.
  const isFromGmail = event?.event_type === "fromGmail";
  const openHref = isFromGmail && event?.source_url ? event.source_url : (event?.html_link ?? null);
  const openLabel = isFromGmail && event?.source_url ? "Otvori email" : "Otvori u Google";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>Google događaj</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {event ? (
          <div className="space-y-4">
            <DetailHero
              icon={GlobeAltIcon}
              iconWrapClassName="bg-sky-100 dark:bg-sky-900/50"
              iconClassName="text-sky-600 dark:text-sky-400"
              title={event.title ?? "(bez naslova)"}
              subtitle={formatDate(event.local_date)}
            />

            <DetailInfoRows>
              <DetailInfoText label="Vreme" value={timeRangeLabel(event)} />
              {event.location ? (
                <DetailInfoRow label="Lokacija" align="baseline">
                  <a
                    href={mapsSearchUrl(event.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-right font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                  >
                    <MapPinIcon className="mr-0.5 inline size-3.5 align-[-2px]" />
                    <span className="underline underline-offset-2">{event.location}</span>
                  </a>
                </DetailInfoRow>
              ) : null}
              {event.description && !isFromGmail ? (
                <DetailInfoText label="Opis" value={event.description} />
              ) : null}
              {event.event_type === "fromGmail" ? (
                <DetailInfoText label="Izvor" value="Automatski iz Gmaila" />
              ) : null}
            </DetailInfoRows>

            {event.ical_uid ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ext-assign">Dodeli osobi</Label>
                    {assigned ? <MemberBadges personIds={[assigned]} size="xs" /> : null}
                  </div>
                  <PersonAssignSelect
                    id="ext-assign"
                    members={members}
                    value={assigned}
                    onChange={onAssign}
                  />
                </div>
                {!event.is_all_day ? (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="ext-remind">Podsetnik</Label>
                    <ReminderSelect
                      id="ext-remind"
                      value={remind}
                      onChange={onRemind}
                      options={EVENT_REMINDER_OPTIONS}
                      className="w-44"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {openHref ? (
              <DetailActionList>
                <DetailActionRow
                  icon={ArrowTopRightOnSquareIcon}
                  label={openLabel}
                  description="Otvara izvor u novom prozoru"
                  href={openHref}
                />
              </DetailActionList>
            ) : null}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Događaj iz tvog Google kalendara - samo za prikaz. Izmene radi u Google-u.
            </p>
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
