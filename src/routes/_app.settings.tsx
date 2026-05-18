import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotifications } from "@/hooks/useNotifications";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Podešavanja</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Upravljanje obaveštenjima i podsetnicima.
        </p>
      </div>
      <NotificationsCard />
    </div>
  );
}

function NotificationsCard() {
  const n = useNotifications();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Obaveštenja</CardTitle>
        <CardDescription>
          Pretplati ovaj uređaj da bi primao podsetnike i jutarnji / večernji pregled. Pretplata se
          čuva na serveru — možeš se pretplatiti na više uređaja istovremeno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!n.supported ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Ovaj uređaj / pregledač ne podržava push obaveštenja. Na iPhone-u prvo dodaj aplikaciju
            na početni ekran i otvori je odatle.
          </p>
        ) : null}

        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500 dark:text-gray-400">Dozvola</dt>
          <dd className="font-mono">{n.permission}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Ovaj uređaj</dt>
          <dd className="font-mono">{n.isSubscribed ? "pretplaćen" : "nije pretplaćen"}</dd>
        </dl>

        {n.error ? <p className="text-sm text-red-600 dark:text-red-400">{n.error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {!n.isSubscribed ? (
            <Button onClick={() => void n.subscribe()} disabled={!n.supported || n.pending}>
              {n.pending ? "Pretplaćivanje…" : "Dozvoli i pretplati se"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void n.unsubscribe()} disabled={n.pending}>
                {n.pending ? "Otpisivanje…" : "Otpiši se"}
              </Button>
              <Button variant="outline" onClick={() => void n.sendLocalTest()}>
                Lokalni test
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
