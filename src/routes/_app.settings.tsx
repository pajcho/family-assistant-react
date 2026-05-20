import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow, parseISO } from "date-fns";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimePicker } from "@/components/ui/time-picker";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useNotificationPreferences,
  type NotificationPreferencesInput,
} from "@/hooks/useNotificationPreferences";
import { useProfile } from "@/hooks/useProfile";
import {
  usePushSubscriptions,
  useTouchCurrentSubscription,
} from "@/hooks/usePushSubscriptions";
import { supabase } from "@/lib/supabase";
import { srLocale } from "@/utils/date";
import { parseUserAgent } from "@/utils/userAgent";
import type { PushSubscriptionRow } from "@/types/database";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Podešavanja</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Lični podaci i obaveštenja na jednom mestu.
        </p>
      </div>
      <Tabs defaultValue="profile" className="gap-6">
        <TabsList className="w-full max-w-sm">
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="notifications">Obaveštenja</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileCard />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileCard() {
  const { user } = useAuth();
  const { profile, isLoading, updateProfile, isUpdating } = useProfile();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailChanging, setEmailChanging] = useState(false);

  // Resync the form whenever the upstream row updates (initial load,
  // post-save refetch, or another tab editing the same profile).
  useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
  }, [profile?.first_name, profile?.last_name]);

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  const namesDirty =
    (profile?.first_name ?? "") !== firstName.trim() ||
    (profile?.last_name ?? "") !== lastName.trim();
  const emailDirty = (user?.email ?? "") !== email.trim();

  const submitProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (namesDirty) {
      await updateProfile({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
      });
    }
    if (emailDirty) {
      setEmailChanging(true);
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      setEmailChanging(false);
      if (error) {
        toast.error(error.message);
        // Roll back the local value so the form reflects what Supabase still has.
        setEmail(user?.email ?? "");
        return;
      }
      // "Secure email change" is turned OFF for this project — Supabase
      // applies the new email immediately and `user.email` updates on
      // the next auth state event without any confirmation step.
      toast.success("Email izmenjen.");
    }
  };

  const identity = {
    firstName,
    lastName,
    email: user?.email ?? null,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lični podaci</CardTitle>
        <CardDescription>
          Ime i prezime se koriste za inicijale i prikaz u meniju. Email se može promeniti i
          primenjuje se odmah.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submitProfile} className="space-y-5">
          <div className="flex items-center gap-4">
            <UserAvatar {...identity} className="h-14 w-14 text-base" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {firstName || lastName ? `${firstName} ${lastName}`.trim() : user?.email}
              </div>
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                {user?.email}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first-name">Ime</Label>
              <Input
                id="first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isLoading || isUpdating}
                autoComplete="given-name"
                placeholder="Vaše ime"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last-name">Prezime</Label>
              <Input
                id="last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isLoading || isUpdating}
                autoComplete="family-name"
                placeholder="Vaše prezime"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={emailChanging}
              autoComplete="email"
              required
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Email se primenjuje odmah, bez dodatne potvrde.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                isLoading || isUpdating || emailChanging || (!namesDirty && !emailDirty)
              }
            >
              {isUpdating || emailChanging ? "Čuva…" : "Sačuvaj"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NotificationsTab() {
  // `useNotifications` is reused by SessionsCard so the current-device
  // row's X can route through `unsubscribe()` (which also tears down
  // the local SW subscription) instead of just deleting the DB row.
  const n = useNotifications();

  // Heartbeat: refresh `last_used_at` on this device's row each time
  // the user lands on the notifications tab. Without this the column
  // only updates on subscribe — meaning a device that's been quietly
  // receiving pushes would still show "subscribed N months ago".
  useTouchCurrentSubscription(n.subscription?.endpoint ?? null);

  return (
    <>
      <NotificationsCard n={n} />
      <SessionsCard n={n} />
      <DigestsCard />
    </>
  );
}

interface NotificationsCardProps {
  n: ReturnType<typeof useNotifications>;
}

function NotificationsCard({ n }: NotificationsCardProps) {
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

interface SessionsCardProps {
  n: ReturnType<typeof useNotifications>;
}

function SessionsCard({ n }: SessionsCardProps) {
  const { subscriptions, isLoading, remove, isRemoving, refresh } = usePushSubscriptions();
  const currentEndpoint = n.subscription?.endpoint ?? null;

  // Hide the card entirely when the user has zero sessions and isn't
  // subscribed on this device — there's literally nothing to manage
  // and showing an empty card would just be visual noise above the
  // digests config.
  if (!isLoading && subscriptions.length === 0 && !n.isSubscribed) {
    return null;
  }

  const handleRevoke = async (row: PushSubscriptionRow) => {
    if (row.endpoint === currentEndpoint) {
      // Current device → route through `unsubscribe()` so the local
      // SW subscription is torn down alongside the DB row. Re-fetch
      // the list afterwards so the row disappears immediately.
      await n.unsubscribe();
      await refresh();
      return;
    }
    await remove(row.id);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aktivne sesije</CardTitle>
        <CardDescription>
          Uređaji na kojima si uključio/la obaveštenja. Klikom na X isključuješ sesiju samo za taj
          uređaj — ostali nastavljaju da rade.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
        ) : subscriptions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Trenutno nema aktivnih sesija. Uključi obaveštenja iznad da bi ovaj uređaj počeo da
            prima podsetnike.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {subscriptions.map((row) => (
              <SessionRow
                key={row.id}
                row={row}
                isCurrent={row.endpoint === currentEndpoint}
                disabled={isRemoving || n.pending}
                onRevoke={() => void handleRevoke(row)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface SessionRowProps {
  row: PushSubscriptionRow;
  isCurrent: boolean;
  disabled: boolean;
  onRevoke: () => void;
}

function SessionRow({ row, isCurrent, disabled, onRevoke }: SessionRowProps) {
  const { label } = parseUserAgent(row.user_agent);
  const lastSeen = formatLastSeen(row.last_used_at);
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {label}
          </span>
          {isCurrent ? (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              ovaj uređaj
            </span>
          ) : null}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{lastSeen}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Isključi sesiju"
        disabled={disabled}
        onClick={onRevoke}
      >
        <XMarkIcon className="h-4 w-4" />
      </Button>
    </li>
  );
}

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "Aktivna pre nepoznato";
  try {
    const date = parseISO(iso);
    const ago = formatDistanceToNow(date, { addSuffix: true, locale: srLocale });
    return `Aktivna ${ago}`;
  } catch {
    return "Aktivna pre nepoznato";
  }
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
