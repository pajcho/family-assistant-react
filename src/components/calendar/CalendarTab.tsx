import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useGoogleCalendars } from "@/hooks/useGoogleCalendars";
import type { GoogleCalendar, GoogleCalendarSharing } from "@/types/database";
import { cn } from "@/lib/cn";

/**
 * Settings → Kalendar. Connect / disconnect Google accounts and choose, per
 * calendar, whether its events are mirrored into the family agenda and to whom
 * (none / private / family). Read-only, one-way — nothing is written to Google.
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
    <Card>
      <CardHeader>
        <CardTitle>Google kalendar</CardTitle>
        <CardDescription>
          Poveži svoj Google nalog i izaberi koje kalendare deliš. Sinhronizacija je jednosmerna i
          samo za čitanje — ništa se ne menja u Google-u.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nijedan Google nalog još nije povezan.
          </p>
        ) : (
          <div className="space-y-6">
            {connections.map((conn) => (
              <div key={conn.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {conn.google_account_email}
                    </div>
                    {conn.needs_reauth ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">
                        Veza je istekla — poveži ponovo da bi sinhronizacija nastavila.
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400">Povezano</div>
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

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void connect()} disabled={isConnecting}>
            {isConnecting
              ? "Povezivanje…"
              : connections.length === 0
                ? "Poveži Google kalendar"
                : "Poveži još jedan nalog"}
          </Button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
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
    return <p className="pl-1 text-xs text-gray-500 dark:text-gray-400">Učitavanje kalendara…</p>;
  }
  if (isError) {
    return (
      <p className="pl-1 text-xs text-amber-600 dark:text-amber-400">
        Greška pri učitavanju kalendara.
      </p>
    );
  }
  if (calendars.length === 0) {
    return <p className="pl-1 text-xs text-gray-500 dark:text-gray-400">Nema kalendara.</p>;
  }
  return (
    <ul className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      {calendars.map((cal) => (
        <li key={cal.id} className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: cal.color ?? "#9ca3af" }}
            />
            <span className="truncate text-sm text-gray-800 dark:text-gray-200">
              {cal.summary ?? cal.google_calendar_id}
              {cal.is_primary ? (
                <span className="text-gray-400 dark:text-gray-500"> (primarni)</span>
              ) : null}
            </span>
          </div>
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
  // Native <select> in Input-matching chrome — same approach as ReminderSelect,
  // so mobile gets the system picker for free.
  return (
    <div className="relative w-36 shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as GoogleCalendarSharing)}
        aria-label="Deljenje kalendara"
        className={cn(
          "h-8 w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-8 pl-3 text-sm shadow-xs outline-none transition-[color,box-shadow] dark:bg-input/30",
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
