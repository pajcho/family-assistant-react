import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { XMarkIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { SettingsPill } from "@/components/settings/SettingsChrome";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useNotificationPreferences,
  type NotificationPreferencesInput,
} from "@/hooks/useNotificationPreferences";
import { usePushSubscriptions, useTouchCurrentSubscription } from "@/hooks/usePushSubscriptions";
import { srLocale } from "@/utils/date";
import { parseUserAgent } from "@/utils/userAgent";
import type { PushSubscriptionRow } from "@/types/database";

/**
 * Notifications - the settings sub-screen that holds everything push: this
 * device's permission, the active sessions, the per-entity family opt-ins and
 * the morning/evening digests. One screen because the last two share a single
 * `notification_preferences` row and save together.
 */
export function NotificationsSection() {
  // `useNotifications` is reused by SessionsCard so the current-device
  // row's X can route through `unsubscribe()` (which also tears down
  // the local SW subscription) instead of just deleting the DB row.
  const n = useNotifications();

  // Heartbeat: refresh `last_used_at` on this device's row each time
  // the user lands on the notifications screen. Without this the column
  // only updates on subscribe - meaning a device that's been quietly
  // receiving pushes would still show "subscribed N months ago".
  // Gated on `isSubscribed`: when the browser's subscription belongs to
  // another account there is no row of ours to touch, and RLS would drop
  // the UPDATE anyway.
  useTouchCurrentSubscription(n.isSubscribed ? (n.subscription?.endpoint ?? null) : null);

  return (
    <>
      <NotificationsCard n={n} />
      <SessionsCard n={n} />
      <FamilyCreateNotificationsCard />
      <DigestsCard />
    </>
  );
}

interface NotificationsCardProps {
  n: ReturnType<typeof useNotifications>;
}

function NotificationsCard({ n }: NotificationsCardProps) {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Push obaveštenja</CardTitle>
        <CardDescription>
          Omogući ovom uređaju da prima podsetnike i jutarnji / večernji pregled. Možeš omogućiti
          notifikacije na više uređaja istovremeno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!n.supported ? (
          <p className="text-sm font-normal text-warn">
            Ovaj uređaj / pregledač ne podržava push obaveštenja. Na iPhone-u prvo dodaj aplikaciju
            na početni ekran i otvori je odatle.
          </p>
        ) : n.permission === "denied" ? (
          // Once permission is denied, calling Notification.requestPermission()
          // silently returns "denied" without re-prompting, so the button below
          // won't recover the state - point the user at browser settings.
          <p className="text-sm font-normal text-warn">
            Dozvola za obaveštenja je odbijena u pregledaču. Otvori postavke pregledača (ili
            sistemske postavke za ovu aplikaciju na iPhone-u) i uključi obaveštenja, pa pokušaj
            ponovo.
          </p>
        ) : null}

        {n.error ? <p className="text-sm font-normal text-neg">{n.error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {n.checking ? (
            // Both halves of `isSubscribed` (browser + server row) have to be
            // in before we can name the button; guessing would flash the
            // wrong one on every load.
            <Button disabled variant="outline">
              Provera…
            </Button>
          ) : !n.isSubscribed ? (
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
  const { subscriptions, isLoading, remove, isRemoving } = usePushSubscriptions();
  const currentEndpoint = n.subscription?.endpoint ?? null;

  // Hide the card entirely when the user has zero sessions and isn't
  // subscribed on this device - there's literally nothing to manage
  // and showing an empty card would just be visual noise above the
  // digests config.
  if (!isLoading && subscriptions.length === 0 && !n.isSubscribed) {
    return null;
  }

  const handleRevoke = async (row: PushSubscriptionRow) => {
    if (row.endpoint === currentEndpoint) {
      // Current device → route through `unsubscribe()` so the local
      // SW subscription is torn down alongside the DB row. It refetches
      // this list itself, so the row disappears immediately.
      await n.unsubscribe();
      return;
    }
    await remove(row.id);
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Aktivne sesije</CardTitle>
        <CardDescription>
          Uređaji na kojima si uključio/la obaveštenja. Klikom na X isključuješ sesiju samo za taj
          uređaj - ostali nastavljaju da rade.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm font-normal text-muted-foreground">Učitavanje…</p>
        ) : subscriptions.length === 0 ? (
          <p className="text-sm font-normal text-muted-foreground">
            Trenutno nema aktivnih sesija. Uključi obaveštenja iznad da bi ovaj uređaj počeo da
            prima podsetnike.
          </p>
        ) : (
          <ul className="divide-y divide-border">
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
          <span className="truncate text-sm font-semibold">{label}</span>
          {isCurrent ? <SettingsPill tone="accent">ovaj uređaj</SettingsPill> : null}
        </div>
        <div className="text-xs font-normal text-muted-foreground">{lastSeen}</div>
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

/**
 * Per-entity toggles for "instant" pushes when another family member
 * creates a list / event / payment / birthday. Backed by 4 boolean
 * columns on `notification_preferences`; share the same hook as the
 * digests card so all opt-ins save together. Defaults to opted-in for
 * every kind - turning notifications on means you probably want to
 * know when your partner adds something.
 */
function FamilyCreateNotificationsCard() {
  const { prefs, isLoading, save, saving } = useNotificationPreferences();
  const [form, setForm] = useState<NotificationPreferencesInput>(prefs);
  useEffect(() => setForm(prefs), [prefs]);

  const dirty =
    form.notify_on_list_create !== prefs.notify_on_list_create ||
    form.notify_on_event_create !== prefs.notify_on_event_create ||
    form.notify_on_payment_create !== prefs.notify_on_payment_create ||
    form.notify_on_birthday_create !== prefs.notify_on_birthday_create;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save(form);
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Obaveštenja porodice</CardTitle>
        <CardDescription>
          Stigne ti push čim neko drugi iz porodice doda novu stavku. Isključi pojedinačno tipove
          koje te ne zanimaju.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-1">
          <FamilyCreateRow
            id="list"
            label="Nova lista"
            checked={form.notify_on_list_create}
            onChange={(v) => setForm((s) => ({ ...s, notify_on_list_create: v }))}
            disabled={isLoading || saving}
          />
          <FamilyCreateRow
            id="event"
            label="Novi događaj"
            checked={form.notify_on_event_create}
            onChange={(v) => setForm((s) => ({ ...s, notify_on_event_create: v }))}
            disabled={isLoading || saving}
          />
          <FamilyCreateRow
            id="payment"
            label="Novo plaćanje"
            checked={form.notify_on_payment_create}
            onChange={(v) => setForm((s) => ({ ...s, notify_on_payment_create: v }))}
            disabled={isLoading || saving}
          />
          <FamilyCreateRow
            id="birthday"
            label="Novi rođendan"
            checked={form.notify_on_birthday_create}
            onChange={(v) => setForm((s) => ({ ...s, notify_on_birthday_create: v }))}
            disabled={isLoading || saving}
          />
          <div className="flex justify-end pt-3">
            <Button type="submit" disabled={isLoading || saving || !dirty}>
              {saving ? "Čuva…" : "Sačuvaj"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface FamilyCreateRowProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

function FamilyCreateRow({ id, label, checked, onChange, disabled }: FamilyCreateRowProps) {
  return (
    <label
      htmlFor={`notify-${id}-toggle`}
      className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-normal"
    >
      <input
        id={`notify-${id}-toggle`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="size-4 cursor-pointer rounded-sm border-border accent-accent"
      />
      {label}
    </label>
  );
}

function DigestsCard() {
  const { prefs, isLoading, save, saving } = useNotificationPreferences();
  // Local form state so toggling and typing time values feels instant
  // - committed on save. Resync whenever the upstream `prefs`
  // change (initial load, post-save refetch, or a save from another tab).
  const [form, setForm] = useState<NotificationPreferencesInput>(prefs);
  useEffect(() => setForm(prefs), [prefs]);

  const dirty =
    form.morning_enabled !== prefs.morning_enabled ||
    form.morning_time !== prefs.morning_time ||
    form.evening_enabled !== prefs.evening_enabled ||
    form.evening_time !== prefs.evening_time;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save(form);
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Pregledi dana</CardTitle>
        <CardDescription>
          Jutarnji pregled stiže ujutru sa svim događajima dana i dospelim plaćanjima. Večernji
          pregled je kratak podsetnik za sutra.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
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
          <p className="text-xs font-normal text-muted-foreground">
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
    <div className="flex min-h-11 items-center gap-3">
      <label
        htmlFor={`${id}-toggle`}
        className="flex cursor-pointer items-center gap-3 text-sm font-normal"
      >
        <input
          id={`${id}-toggle`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={disabled}
          className="size-4 cursor-pointer rounded-sm border-border accent-accent"
        />
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
