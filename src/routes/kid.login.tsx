import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { KidAuthMessage, KidAuthScreen } from "@/components/kid/KidAuthScreen";
import { KidPinPad } from "@/components/kid/KidPinPad";
import { useKidThemeScope } from "@/components/kid/KidThemeScope";
import { attemptsLeftLine, formatLockCountdown } from "@/components/kid/kidCopy";
import { avatarForProfile } from "@/utils/memberAvatar";
import { readKidDevices, useKidLogin } from "@/hooks/useKidLogin";
import type { KidDeviceEntry } from "@/types/kid";

/**
 * Prijava - "Ko si ti?" and a PIN.
 *
 * The profile picker is built ONLY from this device's localStorage, never from
 * the server. That is the privacy requirement, not an optimisation: a stranger
 * who opens the app on a device that was never linked must not be able to learn
 * that this family has children, how many, or what they are called. On such a
 * device this screen has no picker and no keypad at all - just a line telling
 * whoever is holding it to ask a parent for the QR code.
 *
 * Two factors: the device token behind each entry (planted once by a parent's
 * QR link) and the PIN. Neither alone gets in.
 */
export const Route = createFileRoute("/kid/login")({
  component: KidLoginScreen,
});

function KidLoginScreen() {
  const navigate = useNavigate();
  const { setPreviewTheme } = useKidThemeScope();
  const { signIn, message, code, attemptsLeft, retryAfterSeconds, isPending, reset } =
    useKidLogin();

  // Read once: this list only changes on a claim, which navigates away.
  const devices = useMemo(() => readKidDevices(), []);
  const [selectedId, setSelectedId] = useState<string | null>(devices[0]?.profileId ?? null);
  const [pin, setPin] = useState("");

  const selected: KidDeviceEntry | null =
    devices.find((entry) => entry.profileId === selectedId) ?? devices[0] ?? null;

  // Paint the selected child's theme the moment they tap their name.
  useEffect(() => {
    setPreviewTheme(selected?.theme ?? null);
  }, [selected?.theme, setPreviewTheme]);

  // Lockout countdown - the screen ticks it down so the child can watch it
  // shrink instead of guessing when to try again.
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

  async function submit() {
    if (!selected || locked) return;
    const ok = await signIn({ entry: selected, pin });
    setPin("");
    if (ok) await navigate({ to: "/kid" });
  }

  const names = devices.map((entry) => entry.name).filter(Boolean);

  return (
    <KidAuthScreen
      title="Moj dan"
      subtitle="tvoj kutak porodičnog kalendara"
      footer={
        devices.length > 0 ? (
          <>
            Ne sećaš se PIN-a? Pitaj mamu ili tatu da ti daju novi 💛
            <br />
            <span className="text-[11.5px] opacity-80">
              Dečiji nalog uključuje roditelj u glavnoj aplikaciji.
            </span>
          </>
        ) : null
      }
    >
      {devices.length === 0 ? (
        <div className="mt-8 w-full max-w-[300px] rounded-[22px] bg-white/20 px-5 py-6 text-center">
          <span aria-hidden="true" className="text-[42px] leading-none">
            📷
          </span>
          <p className="mt-3 text-[16px] font-semibold">Ovaj uređaj još nije povezan</p>
          <p className="mt-2 text-[13px] leading-relaxed font-normal opacity-95">
            Zamoli mamu ili tatu da u svojoj aplikaciji otvore tvoj profil i pokažu ti QR kod.
            Skeniraj ga i tvoj telefon će te zapamtiti.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-5 text-[14px] font-semibold opacity-95">Ko si ti?</p>

          <div className="mt-2.5 flex flex-wrap justify-center gap-3">
            {devices.map((entry) => {
              const active = entry.profileId === selected?.profileId;
              return (
                <button
                  key={entry.profileId}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedId(entry.profileId);
                    setPin("");
                    reset();
                  }}
                  className={`kid-on-gradient w-[88px] rounded-[22px] border-[2.5px] px-1.5 pt-2.5 pb-2 text-[12.5px] font-semibold transition-transform duration-100 active:scale-[0.93] ${
                    active ? "border-white bg-white/30" : "border-transparent bg-white/15"
                  }`}
                >
                  {/* Whatever this device remembers from the last sign-in - it
                      runs before any session, so there is nothing to query. The
                      picked emoji rides along in `KidDeviceEntry` and refreshes
                      on every sign-in; until a parent picks one, the automatic
                      animal stands in, exactly as inside the app. */}
                  <span aria-hidden="true" className="mb-0.5 block text-[34px] leading-tight">
                    {entry.emoji || avatarForProfile(entry.profileId)}
                  </span>
                  {/* Wraps rather than truncates: a child's own name cut to
                      "Aleksan..." on the button they are meant to recognise is
                      the one place ellipsis is unacceptable. */}
                  <span className="block leading-tight break-words hyphens-auto">{entry.name}</span>
                </button>
              );
            })}
          </div>

          <p className="mt-2.5 max-w-[280px] text-center text-[11.5px] leading-relaxed font-normal opacity-85">
            📱 Ovaj uređaj pamti: {names.join(", ")}
            <br />
            Novo dete? Skeniraj QR kod od roditelja.
          </p>

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

          <div className="mt-4 flex w-full justify-center">
            <KidPinPad
              value={pin}
              onChange={setPin}
              onSubmit={() => void submit()}
              disabled={locked || !selected}
              busy={isPending}
            />
          </div>
        </>
      )}
    </KidAuthScreen>
  );
}
