import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { toast } from "sonner";
import { renderSVG } from "uqr";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { inviteValidityLabel } from "@/components/family/KidAccessCopy";
import { useCreateKidInvite, useKidDevices } from "@/hooks/useKidAccess";
import { cn } from "@/lib/cn";
import type { KidDevice } from "@/types/database";
import {
  KID_INVITE_TTL_MINUTES,
  formatKidInviteCode,
  isKidInviteCode,
  kidInviteUrl,
  type KidInviteResponse,
} from "@/types/kid";

/**
 * Link a device: the one-time code a parent shows the child's phone, as a QR
 * AND as eight readable characters. They are the same secret - see
 * `randomInviteCode` in supabase/functions/_shared/kidCrypto.ts - because the
 * two ways of reading it are not interchangeable on iOS: an installed kid app
 * cannot be handed a scanned URL by Safari, so a child sometimes has to type.
 *
 * The raw code exists ONLY in the response that opened this view - the server
 * stores a hash - so it is fetched when the view mounts, held in component
 * state, and never written to a cache or a query key. Leaving and coming back
 * mints a new one (and invalidates the old), which is also the recovery path
 * when the countdown runs out.
 *
 * The QR sits on a hard-white card in both themes: a dark-mode QR with a dark
 * surround is unreadable to most camera apps, and this is often scanned in a
 * kid's dim bedroom.
 */

export type KidAccessInviteViewProps = {
  profileId: string;
  memberName: string;
  /** "Zatvori" at the root, "Nazad" when opened on top of the device list. */
  closeLabel: string;
  onClose: () => void;
};

/** How long the parent reads "povezan" before the sheet closes itself. */
const LINKED_CLOSE_DELAY_MS = 2400;

/**
 * The device this screen is being held up FOR, once it appears - or null while
 * the parent is still waiting.
 *
 * A NEW id rather than a bigger count or a fresh `created_at`: the child may be
 * linking their second device, and a timestamp comparison would ride on the
 * phone's clock agreeing with the database's. The ids present when this screen
 * opened are the baseline, and anything outside that set arrived just now.
 *
 * The baseline is taken only once the list has actually loaded. Taken from an
 * empty list mid-fetch, every device the child already had would read as
 * "linked just now" and the screen would congratulate the parent for nothing.
 */
function useJustLinkedDevice(profileId: string, waiting: boolean): KidDevice | null {
  const [linked, setLinked] = useState<KidDevice | null>(null);
  const { devices, isLoading } = useKidDevices(profileId, { watch: waiting && !linked });
  const baseline = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (isLoading || linked) return;
    if (baseline.current === null) {
      baseline.current = new Set(devices.map((device) => device.id));
      return;
    }
    const fresh = devices.find((device) => !baseline.current?.has(device.id));
    if (fresh) setLinked(fresh);
  }, [devices, isLoading, linked]);

  return linked;
}

function secondsUntil(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.round((target - Date.now()) / 1000));
}

/**
 * Seconds remaining until `expiresAt`, ticking once a second.
 *
 * Derived during render rather than held in state: the token arrives one render
 * after the view mounts, and a state-based counter would spend that first frame
 * on its initial 0 - which reads as "istekao" and would flash a greyed-out QR
 * with a "Napravi novi link" button at the parent before correcting itself. The
 * interval only forces the re-render; the number always comes from the clock.
 */
function useSecondsLeft(expiresAt: string | null): number {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return secondsUntil(expiresAt);
}

export function KidAccessInviteView({
  profileId,
  memberName,
  closeLabel,
  onClose,
}: KidAccessInviteViewProps) {
  const createInvite = useCreateKidInvite();
  const { mutateAsync } = createInvite;
  const [copied, setCopied] = useState(false);

  /**
   * The token lives in component state, NOT in `createInvite.data`. Firing a
   * mutation from a mount effect under StrictMode tears down and rebuilds the
   * mutation observer between the call and the response, so the result is
   * dropped and the view would sit on "Pravim link…" forever even though the
   * server answered 200 and burned a real token. Plain state survives that
   * remount, and it is the right home anyway: the raw token exists only here.
   */
  const [invite, setInvite] = useState<KidInviteResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [errored, setErrored] = useState(false);

  const request = useCallback(() => {
    setPending(true);
    setErrored(false);
    mutateAsync(profileId)
      .then((result) => setInvite(result))
      // The hook already toasts; here we only need the inline failed state.
      .catch(() => setErrored(true))
      .finally(() => setPending(false));
  }, [mutateAsync, profileId]);

  // One automatic request per mount - the parent already asked by opening this
  // view. The ref survives StrictMode's double effect run, which would
  // otherwise burn a token immediately (the server drops the older invite).
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    request();
  }, [request]);

  const secondsLeft = useSecondsLeft(invite?.expiresAt ?? null);
  const expired = !!invite && secondsLeft <= 0;
  const url = invite ? kidInviteUrl(invite.token) : null;

  const svg = useMemo(
    () =>
      url
        ? renderSVG(url, {
            border: 2,
            pixelSize: 8,
            ecc: "M",
            whiteColor: "#ffffff",
            blackColor: "#000000",
          })
        : null,
    [url],
  );

  // `pending` starts true so the very first frame - before the mount effect has
  // even fired - already reads as loading and the sheet never opens blank. A
  // regenerate also clears `invite` first: asking for a new link deletes the old
  // one server-side, so leaving its QR up would offer a code that no longer works.
  const loading = pending;
  const failed = errored && !pending;

  // The other end of the code. A parent holding this screen up has no way of
  // knowing it worked - the child's phone says so, on the far side of the room -
  // so the moment a device appears, say it here and get out of the way.
  // Only while a code is actually live: an expired one cannot link anything.
  const linked = useJustLinkedDevice(profileId, !!invite && !expired);

  // Closed from a ref, not from `onClose` itself: the parent passes an inline
  // arrow, so a dependency on it would restart this timer on every poll and it
  // would never fire.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!linked) return;
    const timer = window.setTimeout(() => closeRef.current(), LINKED_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [linked]);

  const regenerate = () => {
    setCopied(false);
    setInvite(null);
    request();
  };

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      toast.success("Link kopiran");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopiranje nije uspelo - link je ispisan iznad, prepiši ga ručno.");
    }
  };

  return (
    <div className="space-y-4">
      {linked ? (
        <KidDeviceLinkedPanel device={linked} memberName={memberName} />
      ) : loading ? (
        <div className="space-y-3">
          <div className="mx-auto aspect-square w-full max-w-[240px] animate-pulse rounded-2xl bg-muted" />
          <p className="text-center text-sm font-normal text-muted-foreground">
            Pravim link za povezivanje…
          </p>
        </div>
      ) : failed ? (
        <div className="space-y-3">
          <p className="text-sm font-normal text-muted-foreground">
            Link nije napravljen. Proveri internet i pokušaj ponovo.
          </p>
          <Button variant="outline" onClick={regenerate}>
            <ArrowPathIcon className="size-4" />
            Pokušaj ponovo
          </Button>
        </div>
      ) : invite && url && svg ? (
        <>
          <p className="text-sm font-normal text-muted-foreground">
            Skeniraj ovaj kod na uređaju deteta, pa unesi PIN da završiš povezivanje. Kod važi samo
            jednom i samo za taj jedan uređaj.
          </p>

          {/* The order matters on an iPhone and nowhere else, so it is one line
              rather than a section: a home-screen web app has its own storage,
              and a device linked in Safari is a stranger to it. */}
          <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed font-normal text-muted-foreground">
            <span className="font-semibold text-foreground">iPhone?</span> Neka dete prvo doda
            aplikaciju na početni ekran, pa je otvori i tek onda skenira kod - iz same aplikacije,
            dugmetom &bdquo;Skeniraj QR kod&ldquo;. Kod skeniran kamerom telefona povezuje samo
            Safari.
          </p>

          {/* Hard-white card in both themes - a camera has to see the code. */}
          <div className="mx-auto w-full max-w-[240px] rounded-2xl bg-white p-3 shadow-card">
            <div
              role="img"
              aria-label={`QR kod za povezivanje uređaja - ${memberName}`}
              className={cn(
                "[&>svg]:block [&>svg]:h-auto [&>svg]:w-full",
                expired && "opacity-25 grayscale",
              )}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>

          <p
            className={cn(
              "text-center text-[13px] font-normal tabular-nums",
              expired
                ? "text-destructive"
                : secondsLeft < 60
                  ? "text-warn"
                  : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {inviteValidityLabel(secondsLeft)}
          </p>

          {expired ? (
            <Button className="w-full" onClick={regenerate} disabled={pending}>
              <ArrowPathIcon className="size-4" />
              {pending ? "Pravim novi link…" : "Napravi novi link"}
            </Button>
          ) : (
            <div className="space-y-2">
              {/* The same secret the QR carries, for a child who cannot scan -
                  the app's own camera refused, or there is none. Hidden if the
                  function still mints long tokens (an edge deploy that has not
                  landed yet); the QR and the link work either way. */}
              {isKidInviteCode(invite.token) ? (
                <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-center">
                  <p className="text-xs font-normal text-muted-foreground">
                    Ili neka dete ukuca ovaj kod u aplikaciji:
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-[0.2em] text-foreground select-all">
                    {formatKidInviteCode(invite.token)}
                  </p>
                </div>
              ) : null}

              <p className="text-xs font-normal text-muted-foreground">
                Ako kamera ne prepoznaje kod, otvori ovaj link na uređaju deteta:
              </p>
              <p className="rounded-lg border border-border bg-muted px-3 py-2 text-[11.5px] leading-snug break-all select-all">
                {url}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  void copyLink();
                }}
              >
                {copied ? (
                  <ClipboardDocumentCheckIcon className="size-4" />
                ) : (
                  <ClipboardDocumentIcon className="size-4" />
                )}
                {copied ? "Kopirano" : "Kopiraj link"}
              </Button>
            </div>
          )}

          <p className="text-xs font-normal text-muted-foreground">
            Link se prikazuje samo sada i važi {KID_INVITE_TTL_MINUTES} minuta. Za još jedan uređaj
            napravi novi.
          </p>
        </>
      ) : null}

      <ResponsiveDialogFooter>
        <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
          {closeLabel}
        </Button>
      </ResponsiveDialogFooter>
    </div>
  );
}

/**
 * "Povezano" - the answer the parent has been standing there waiting for.
 *
 * It says which device, because a parent linking a second one needs to know it
 * was the right phone, and it names the next thing the child does (their PIN)
 * so nobody goes looking for another step. The sheet closes itself a beat
 * later; the device list behind it has already refreshed.
 */
function KidDeviceLinkedPanel({ device, memberName }: { device: KidDevice; memberName: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-2xl bg-pos-soft px-5 py-7 text-center"
    >
      <CheckCircleIcon className="size-11 text-pos" />
      <p className="text-base font-semibold text-foreground">
        {device.label ? `Povezan je ${device.label}` : "Uređaj je povezan"}
      </p>
      <p className="max-w-xs text-sm leading-relaxed font-normal text-muted-foreground">
        {memberName} se od sada prijavljuje samo svojim PIN-om.
      </p>
    </div>
  );
}
