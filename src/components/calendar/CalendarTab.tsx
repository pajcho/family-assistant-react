import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";

/**
 * Settings → Kalendar. Connect / disconnect Google accounts whose calendars get
 * mirrored (read-only, one-way) into the family agenda. Calendar selection and
 * the actual sync land in later phases — this tab only owns the OAuth link.
 */
export function CalendarTab() {
  const { connections, isLoading, connect, isConnecting, disconnect, isDisconnecting } =
    useGoogleCalendar();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google kalendar</CardTitle>
        <CardDescription>
          Poveži svoj Google nalog da bi se događaji iz tvog kalendara prikazivali u porodičnoj
          agendi. Sinhronizacija je jednosmerna i samo za čitanje — ništa se ne menja u Google-u.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nijedan Google nalog još nije povezan.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {c.google_account_email}
                  </div>
                  {c.needs_reauth ? (
                    <div className="text-xs text-amber-600 dark:text-amber-400">
                      Veza je istekla — poveži ponovo da bi sinhronizacija nastavila.
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 dark:text-gray-400">Povezano</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {c.needs_reauth ? (
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
                    onClick={() => void disconnect(c.id)}
                    disabled={isDisconnecting}
                  >
                    Isključi
                  </Button>
                </div>
              </li>
            ))}
          </ul>
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
