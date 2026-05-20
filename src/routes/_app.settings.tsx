import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { supabase } from "@/lib/supabase";

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
          <NotificationsCard />
          <DigestsCard />
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
      // Supabase sends a confirmation to the new address (and, depending on
      // project settings, also to the old one). The session keeps the old
      // email until the user clicks through, so we tell them what to expect.
      toast.success("Poslat ti je email za potvrdu nove adrese.");
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
          Ime i prezime se koriste za inicijale i prikaz u meniju. Email se može promeniti — na
          novu adresu šaljemo link za potvrdu.
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
                placeholder="Nikola"
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
                placeholder="Pajić"
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
              Promena email-a zahteva potvrdu preko linka koji stiže na novu adresu.
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
