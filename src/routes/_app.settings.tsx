import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useNotificationPreferences,
  type NotificationPreferencesInput,
} from "@/hooks/useNotificationPreferences";

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
      <DigestsCard />
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
          Omogući ovom uređaju da prima podsetnike i jutarnji / večernji pregled. Možeš omogućiti
          notifikacije na više uređaja istovremeno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!n.supported ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Ovaj uređaj / pregledač ne podržava push obaveštenja. Na iPhone-u prvo dodaj aplikaciju
            na početni ekran i otvori je odatle.
          </p>
        ) : n.permission === "denied" ? (
          // Once permission is denied, calling Notification.requestPermission()
          // silently returns "denied" without re-prompting, so the button below
          // won't recover the state — point the user at browser settings.
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Dozvola za obaveštenja je odbijena u pregledaču. Otvori postavke pregledača (ili
            sistemske postavke za ovu aplikaciju na iPhone-u) i uključi obaveštenja, pa pokušaj
            ponovo.
          </p>
        ) : null}

        {n.error ? <p className="text-sm text-red-600 dark:text-red-400">{n.error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {!n.isSubscribed ? (
            <Button onClick={() => void n.subscribe()} disabled={!n.supported || n.pending}>
              {n.pending ? "Uključivanje…" : "Uključi obaveštenja"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void n.unsubscribe()} disabled={n.pending}>
                {n.pending ? "Isključivanje…" : "Isključi obaveštenja"}
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

function DigestsCard() {
  const { prefs, isLoading, save, saving } = useNotificationPreferences();
  // Local form state so toggling and typing time values feels instant
  // — committed on "Sačuvaj". Resync whenever the upstream `prefs`
  // change (initial load, post-save refetch, or a save from another tab).
  const [form, setForm] = useState<NotificationPreferencesInput>(prefs);
  useEffect(() => setForm(prefs), [prefs]);

  const dirty =
    form.morning_enabled !== prefs.morning_enabled ||
    form.morning_time !== prefs.morning_time ||
    form.evening_enabled !== prefs.evening_enabled ||
    form.evening_time !== prefs.evening_time;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save(form);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dnevni pregledi</CardTitle>
        <CardDescription>
          Jutarnji pregled stiže ujutru sa svim događajima dana i dospelim plaćanjima. Večernji
          pregled je kratak podsetnik za sutra.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <DigestRow
            id="morning"
            label="Jutarnji pregled"
            enabled={form.morning_enabled}
            time={form.morning_time}
            onToggle={(v) => setForm((s) => ({ ...s, morning_enabled: v }))}
            onTime={(t) => setForm((s) => ({ ...s, morning_time: t ?? s.morning_time }))}
            disabled={isLoading || saving}
          />
          <DigestRow
            id="evening"
            label="Večernji pregled"
            enabled={form.evening_enabled}
            time={form.evening_time}
            onToggle={(v) => setForm((s) => ({ ...s, evening_enabled: v }))}
            onTime={(t) => setForm((s) => ({ ...s, evening_time: t ?? s.evening_time }))}
            disabled={isLoading || saving}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Vremenska zona: <span className="font-mono">{form.timezone}</span>
          </p>
          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading || saving || !dirty}>
              {saving ? "Čuva…" : "Sačuvaj"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface DigestRowProps {
  id: string;
  label: string;
  enabled: boolean;
  time: string;
  onToggle: (next: boolean) => void;
  onTime: (next: string | null) => void;
  disabled?: boolean;
}

function DigestRow({ id, label, enabled, time, onToggle, onTime, disabled }: DigestRowProps) {
  // Keep the checkbox + text inside the <label htmlFor>, but the
  // TimePicker sits outside so its inline X (and the native time popup)
  // don't bubble clicks back into the label and re-toggle the digest.
  return (
    <div className="flex items-center gap-3">
      <input
        id={`${id}-toggle`}
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 cursor-pointer rounded border-gray-300"
      />
      <label
        htmlFor={`${id}-toggle`}
        className="cursor-pointer text-sm text-gray-700 dark:text-gray-200"
      >
        {label}
      </label>
      <div className="ml-auto w-32 shrink-0">
        <Label htmlFor={`${id}-time`} className="sr-only">
          Vreme za {label}
        </Label>
        <TimePicker
          id={`${id}-time`}
          value={time}
          onChange={(v) => onTime(v)}
          disabled={disabled || !enabled}
          clearable={false}
        />
      </div>
    </div>
  );
}

