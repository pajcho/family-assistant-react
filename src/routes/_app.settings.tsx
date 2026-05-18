import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardDocumentIcon, CheckIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
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
  const [copied, setCopied] = useState(false);

  const subscriptionJson = n.subscription ? JSON.stringify(n.subscription, null, 2) : "";

  const copySubscription = async () => {
    if (!subscriptionJson) return;
    try {
      await navigator.clipboard.writeText(subscriptionJson);
      setCopied(true);
      toast.success("Pretplata kopirana u clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error(`Kopiranje neuspešno: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Obaveštenja</CardTitle>
        <CardDescription>
          Trenutno u fazi testiranja — push obaveštenja se još ne šalju automatski. Pretplati ovaj
          uređaj i podeli JSON ispod da bismo poslali test push.
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
          <dt className="text-gray-500 dark:text-gray-400">Pretplata</dt>
          <dd className="font-mono">{n.isSubscribed ? "aktivna" : "nema"}</dd>
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

        {n.subscription ? (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Pretplata (kopiraj i pošalji za test)</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copySubscription()}
                className="gap-1"
              >
                {copied ? (
                  <>
                    <CheckIcon className="h-4 w-4" />
                    Kopirano
                  </>
                ) : (
                  <>
                    <ClipboardDocumentIcon className="h-4 w-4" />
                    Kopiraj
                  </>
                )}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              {subscriptionJson}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
