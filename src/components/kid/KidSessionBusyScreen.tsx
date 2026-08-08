import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { KidAuthScreen } from "@/components/kid/KidAuthScreen";
import { useAuth } from "@/hooks/useAuth";
import { findKidDevice } from "@/hooks/useKidLogin";
import { useKidSession } from "@/hooks/useKidSession";

/**
 * "Someone is already signed in on this device."
 *
 * Reached when an active session hits a pre-session kid route - almost always a
 * parent opening the device-link QR on a phone that is already signed in to the
 * grown-up app, sometimes a sibling already signed in on a shared tablet.
 *
 * Why a screen instead of a redirect: the invite token rides in the URL
 * FRAGMENT, so a `<Navigate>` throws it away, and the link is SINGLE USE - the
 * parent would have to go back and mint a new one without ever being told why.
 * Rendering here keeps the fragment in the address bar untouched, so signing
 * out drops the caller straight into the PIN step with the same link intact.
 *
 * The audience is an adult even though the frame is the kid one (this is the
 * child's device, and the child may be watching), so the copy is plain rather
 * than childish, and it says out loud what signing out actually costs.
 */
export function KidSessionBusyScreen() {
  const { user, signOut } = useAuth();
  const { isKid, kidProfileId } = useKidSession();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  // A signed-in child's name comes off this device's own record - no query, and
  // it is the same name their login button carries.
  const kidName = isKid ? (findKidDevice(kidProfileId)?.name ?? null) : null;
  const who = isKid ? (kidName ?? "Drugo dete") : (user?.email ?? "Tvoj nalog");

  const handleSignOut = async () => {
    setSigningOut(true);
    // Deliberately no navigation: the layout re-renders without a session and
    // hands over to the route, which reads the token still sitting in the URL.
    await signOut();
  };

  return (
    <KidAuthScreen
      emoji="🔒"
      title="Neko je već prijavljen"
      subtitle={
        isKid
          ? "Na ovom uređaju je prijavljeno drugo dete"
          : "Na ovom uređaju je prijavljena glavna aplikacija"
      }
    >
      <div className="mt-5 w-full rounded-[22px] border-2 border-white/35 bg-white/15 px-4 py-3.5 text-center">
        <p className="text-[12px] font-medium tracking-[0.08em] text-white/75 uppercase">
          Prijavljen
        </p>
        <p className="mt-1 text-[15.5px] leading-snug font-semibold break-words">{who}</p>
      </div>

      <p className="mt-4 text-center text-[13.5px] leading-relaxed font-normal text-white/90">
        {isKid
          ? "Dečija aplikacija prikazuje jedno dete odjednom. Da bi se povezalo drugo, prvo se odjavi sa ovog."
          : "Dečija aplikacija ne može da se otvori dok je prijavljen neki drugi nalog. Odjavi se pa nastavi."}
      </p>

      <div className="mt-6 flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="kid-on-gradient w-full rounded-[18px] bg-white px-4 py-3.5 text-[16.5px] font-bold text-[var(--k-accent-strong)] shadow-lg transition-transform duration-100 active:scale-[0.96] disabled:opacity-70"
        >
          {signingOut ? "Odjavljujem..." : "Odjavi se i nastavi"}
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: isKid ? "/kid" : "/" })}
          className="kid-on-gradient w-full rounded-[18px] border-2 border-white/45 px-4 py-3 text-[14.5px] font-semibold transition-transform duration-100 active:scale-[0.96]"
        >
          {isKid ? "Nazad u moju aplikaciju" : "Nazad na glavnu aplikaciju"}
        </button>
      </div>

      {/* The one thing a parent standing there actually worries about. */}
      <p className="mt-4 text-center text-[12px] leading-relaxed font-normal text-white/75">
        Odjava ne troši link za povezivanje - on i dalje važi 💛
      </p>
    </KidAuthScreen>
  );
}
