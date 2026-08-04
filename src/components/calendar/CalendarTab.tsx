import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useGoogleCalendars } from "@/hooks/useGoogleCalendars";
import { useGoogleSyncPrefs } from "@/hooks/useGoogleSyncPrefs";
import type {
  GoogleCalendar,
  GoogleCalendarSharing,
  GoogleSyncPreferences,
} from "@/types/database";
import { cn } from "@/lib/cn";

/**
 * Settings → Kalendar. Connect / disconnect Google accounts and choose, per
 * calendar, whether its events are mirrored into the family agenda and to whom
 * (none / private / family). Read-only, one-way - nothing is written to Google.
 */
export function CalendarTab() {
  const { connections, isLoading, connect, isConnecting, disconnect, isDisconnecting } =
    useGoogleCalendar();
  const {
    calendars,
    isLoading: calendarsLoading,
    isError: calendarsError,
    setSharing,
  } = useGoogleCalendars(connections.length > 0);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Google kalendar</CardTitle>
        <CardDescription>
          Poveži svoj Google nalog i izaberi koje kalendare deliš. Sinhronizacija je jednosmerna i
          samo za čitanje - ništa se ne menja u Google-u.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Učitavanje…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nijedan Google nalog još nije povezan.</p>
        ) : (
          <div className="space-y-6">
            {connections.map((conn) => (
              <div key={conn.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold text-foreground">
                      {conn.google_account_email}
                    </div>
                    {conn.needs_reauth ? null : (
                      <div className="text-xs font-semibold text-muted-foreground">Povezano</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {conn.needs_reauth ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void connect()}
                        disabled={isConnecting}
                      >
                        Poveži ponovo
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void disconnect(conn.id)}
                      disabled={isDisconnecting}
                    >
                      Isključi
                    </Button>
                  </div>
                </div>

                {/* Expired connection: the attention banner sits full width under
                    the account row so the long sentence isn't squeezed next to
                    the buttons. */}
                {conn.needs_reauth ? (
                  <div className="flex items-center gap-2.5 rounded-[15px] bg-warn-soft px-[13px] py-[11px] text-[13.5px] font-bold text-warn">
                    <ExclamationTriangleIcon className="size-[18px] shrink-0" aria-hidden="true" />
                    Veza je istekla - poveži ponovo da bi sinhronizacija nastavila.
                  </div>
                ) : null}

                <ConnectionCalendars
                  calendars={calendars.filter((c) => c.connection_id === conn.id)}
                  isLoading={calendarsLoading}
                  isError={calendarsError}
                  onSharingChange={(calendarId, sharing) => setSharing({ calendarId, sharing })}
                />
              </div>
            ))}
          </div>
        )}

        {connections.length > 0 ? <ImportPrefs /> : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void connect()} disabled={isConnecting}>
            {isConnecting
              ? "Povezivanje…"
              : connections.length === 0
                ? "Poveži Google kalendar"
                : "Poveži još jedan nalog"}
          </Button>
        </div>

        <p className="text-[11.5px] leading-relaxed font-semibold text-muted-foreground">
          Napomena: dok je aplikacija u Google „testing" režimu, veza može isteći nakon 7 dana, pa
          će biti potrebno ponovno povezivanje.
        </p>
      </CardContent>
    </Card>
  );
}

interface ConnectionCalendarsProps {
  calendars: GoogleCalendar[];
  isLoading: boolean;
  isError: boolean;
  onSharingChange: (calendarId: string, sharing: GoogleCalendarSharing) => void;
}

function ConnectionCalendars({
  calendars,
  isLoading,
  isError,
  onSharingChange,
}: ConnectionCalendarsProps) {
  if (isLoading) {
    return (
      <p className="pl-1 text-xs font-semibold text-muted-foreground">Učitavanje kalendara…</p>
    );
  }
  if (isError) {
    return <p className="pl-1 text-xs font-semibold text-warn">Greška pri učitavanju kalendara.</p>;
  }
  if (calendars.length === 0) {
    return <p className="pl-1 text-xs font-semibold text-muted-foreground">Nema kalendara.</p>;
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {calendars.map((cal) => (
        <li key={cal.id} className="flex items-center justify-between gap-3 px-[13px] py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: cal.color ?? "var(--muted-foreground)" }}
            />
            <span className="truncate text-sm font-semibold text-foreground">
              {cal.summary ?? cal.google_calendar_id}
              {cal.is_primary ? <span className="text-muted-foreground"> (primarni)</span> : null}
            </span>
          </div>
          {typeof cal.event_count === "number" ? (
            <span
              className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground"
              title="Događaja pronađeno (oko godinu dana unapred)"
            >
              {cal.event_count}
              {cal.event_count_capped ? "+" : ""}
            </span>
          ) : null}
          <SharingSelect
            value={cal.sharing}
            onChange={(sharing) => onSharingChange(cal.id, sharing)}
          />
        </li>
      ))}
    </ul>
  );
}

const SHARING_OPTIONS: ReadonlyArray<{ value: GoogleCalendarSharing; label: string }> = [
  { value: "none", label: "Ne uvozi" },
  { value: "private", label: "Samo ja" },
  { value: "family", label: "Cela porodica" },
];

interface SharingSelectProps {
  value: GoogleCalendarSharing;
  onChange: (value: GoogleCalendarSharing) => void;
}

function SharingSelect({ value, onChange }: SharingSelectProps) {
  // Native <select> in Input-matching chrome - same approach as ReminderSelect,
  // so mobile gets the system picker for free.
  return (
    <div className="relative w-36 shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as GoogleCalendarSharing)}
        aria-label="Deljenje kalendara"
        className={cn(
          "h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-8 pl-3 text-sm font-semibold shadow-xs outline-none transition-[color,box-shadow] dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {SHARING_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

/**
 * Per-member "what to import" toggles (skip-list - `default` events always come).
 * Applies across all the member's calendars; changing one re-syncs them.
 */
function ImportPrefs() {
  const { prefs, isLoading, setPrefs, isSaving } = useGoogleSyncPrefs(true);
  const toggle = (key: keyof GoogleSyncPreferences) => setPrefs({ ...prefs, [key]: !prefs[key] });
  const disabled = isLoading || isSaving;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h4 className="text-[11.5px] font-extrabold tracking-[0.08em] text-muted-foreground uppercase">
        Šta uvozim sa Google-a
      </h4>
      <PrefRow
        id="from-gmail"
        label="Putovanja iz Gmaila (letovi, hoteli)"
        checked={prefs.import_from_gmail}
        onChange={() => toggle("import_from_gmail")}
        disabled={disabled}
      />
      <PrefRow
        id="birthdays"
        label="Rođendani iz kontakata"
        checked={prefs.import_birthdays}
        onChange={() => toggle("import_birthdays")}
        disabled={disabled}
      />
      <PrefRow
        id="work-markers"
        label="Radni markeri (van kancelarije, fokus, lokacija)"
        checked={prefs.import_work_markers}
        onChange={() => toggle("import_work_markers")}
        disabled={disabled}
      />
      <p className="text-[11.5px] leading-relaxed font-semibold text-muted-foreground">
        Obični događaji se uvek uvoze. Promena odmah re-sinhronizuje tvoje kalendare.
      </p>
    </div>
  );
}

function PrefRow({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <input
        id={`gcal-pref-${id}`}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
      />
      <label
        htmlFor={`gcal-pref-${id}`}
        className="cursor-pointer text-[14.5px] font-bold text-foreground"
      >
        {label}
      </label>
    </div>
  );
}
