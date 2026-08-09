import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";

import { KidAuthMessage, KidAuthScreen } from "@/components/kid/KidAuthScreen";
import { KidInstallFirst } from "@/components/kid/KidInstallFirst";
import { KidPinPad } from "@/components/kid/KidPinPad";
import { useKidThemeScope } from "@/components/kid/KidThemeScope";
import { attemptsLeftLine, formatLockCountdown } from "@/components/kid/kidCopy";
import { canInstallOnIos } from "@/utils/pwaInstall";
import { useKidLogin } from "@/hooks/useKidLogin";

/**
 * Veza - the PIN step of linking a device, and the one screen every route into
 * it ends at: a QR scanned with the phone's camera app, the same QR scanned
 * from inside the installed kid app, and a code typed by hand.
 *
 * The invite token rides in the URL FRAGMENT (`/kid/veza#<token>`), so it never
 * reaches a server log, a proxy or a Referer header. We read it once on mount
 * and strip it from the address bar immediately, so it also never survives in
 * history or in a screenshot of the address bar.
 *
 * A link alone is not enough to get in: the child still types their PIN, and
 * only then does this device get remembered.
 *
 * On an iPhone still in the browser there is a step BEFORE the PIN - see
 * `KidInstallFirst`. Whatever is linked in Safari is invisible to the app once
 * it is on the home screen (separate storage container), and the invite is
 * single use, so the order actually matters.
 */
export const Route = createFileRoute("/kid/veza")({
  component: KidLinkDeviceScreen,
});

/** Codes that mean the link itself is spent - a new PIN attempt cannot help. */
const DEAD_LINK_CODES = new Set(["invite_invalid", "invite_expired", "invite_used"]);

/** The invite token out of a URL fragment, with or without its leading `#`. */
function readHashToken(hash: string | null | undefined): string | null {
  const raw = (hash ?? "").replace(/^#/, "").trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function KidLinkDeviceScreen() {
  const navigate = useNavigate();
  const { setPreviewTheme } = useKidThemeScope();
  const { claim, message, code, attemptsLeft, retryAfterSeconds, isPending } = useKidLogin();

  // Captured during the FIRST RENDER, not in an effect. Under StrictMode an
  // effect runs, is torn down and runs again - and since the first run wipes
  // the fragment, the second one would read an empty hash and decide the link
  // was missing. A lazy state initializer runs before any of that, and the
  // router's own location is a second source in case the URL was normalized
  // before this route's module even loaded.
  const routerHash = useRouterState({ select: (state) => state.location.hash });
  const [token] = useState<string | null>(
    () => readHashToken(window.location.hash) ?? readHashToken(routerHash),
  );
  const [pin, setPin] = useState("");

  // Wipe the token out of the address bar as soon as we have it, so it never
  // survives in history, in a screenshot, or in whatever the browser syncs.
  //
  // Through the ROUTER, not `history.replaceState`: TanStack Router holds the
  // hash in its own location state and re-syncs the URL from it, so a raw
  // replaceState is silently undone a tick later and the token comes back.
  useEffect(() => {
    if (!routerHash) return;
    void navigate({ to: "/kid/veza", hash: "", replace: true, resetScroll: false });
  }, [routerHash, navigate]);

  const [lockSeconds, setLockSeconds] = useState(0);
  useEffect(() => {
    if (code !== "locked" || !retryAfterSeconds) return;
    setLockSeconds(retryAfterSeconds);
    const timer = window.setInterval(() => {
      setLockSeconds((seconds) => (seconds <= 1 ? 0 : seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [code, retryAfterSeconds]);

  const locked = code === "locked" && lockSeconds > 0;
  const deadLink = code !== null && DEAD_LINK_CODES.has(code);

  // Read once, on the first render: an install cannot happen while this screen
  // is up (iOS reloads the document into a new container), so re-checking would
  // only risk the answer changing under a child mid-PIN.
  const [installFirst, setInstallFirst] = useState(canInstallOnIos);

  async function submit() {
    if (!token || locked) return;
    const entry = await claim({ token, pin });
    setPin("");
    if (entry) {
      setPreviewTheme(entry.theme);
      await navigate({ to: "/kid" });
    }
  }

  // Somebody opened /kid/veza without a token, or the link was already spent.
  if (!token || deadLink) {
    return (
      <KidAuthScreen emoji="🔗" title="Ups!" subtitle="ovaj link ne radi">
        <div className="mt-8 w-full max-w-[300px] rounded-[22px] bg-white/20 px-5 py-6 text-center">
          <p className="text-[14px] leading-relaxed font-normal">
            {message ?? "Link za povezivanje je istekao ili je već iskorišćen."}
            <br />
            Zamoli mamu ili tatu da naprave novi QR kod.
          </p>
        </div>
        <Link
          to="/kid/login"
          className="kid-on-gradient mt-5 w-full max-w-[300px] rounded-[18px] bg-white px-4 py-4 text-center text-[16px] font-bold text-[var(--k-accent-strong)] shadow-[0_10px_24px_-10px_rgb(0_0_0/0.35)]"
        >
          Nazad na prijavu
        </Link>
      </KidAuthScreen>
    );
  }

  // The order-of-operations step, and only on an iPhone in the browser: an
  // installed app cannot see anything this screen would link here.
  if (installFirst) return <KidInstallFirst onContinue={() => setInstallFirst(false)} />;

  return (
    <KidAuthScreen
      emoji="🔗"
      title="Poveži telefon"
      subtitle="još samo tvoj PIN i gotovo"
      footer={
        <>
          Posle ovoga te uređaj pamti -
          <br />
          sledeći put ti treba samo PIN 💛
        </>
      }
    >
      {message ? (
        <KidAuthMessage>
          {locked
            ? `Previše pokušaja. Probaj ponovo ${formatLockCountdown(lockSeconds)}.`
            : message}
          {code === "invalid_pin" && typeof attemptsLeft === "number" ? (
            <>
              <br />
              {attemptsLeftLine(attemptsLeft)}
            </>
          ) : null}
        </KidAuthMessage>
      ) : null}

      <div className="mt-6 flex w-full justify-center">
        <KidPinPad
          value={pin}
          onChange={setPin}
          onSubmit={() => void submit()}
          disabled={locked}
          busy={isPending}
          submitLabel="Poveži 🔗"
        />
      </div>
    </KidAuthScreen>
  );
}
