import { useState } from "react";

import { KidAuthScreen } from "@/components/kid/KidAuthScreen";
import {
  KID_INVITE_CODE_LENGTH,
  formatKidInviteCode,
  isKidInviteCode,
  kidInviteTokenFromScan,
  normalizeKidInviteCode,
} from "@/types/kid";

/**
 * "Ukucaj kod" - the eight characters a parent reads off their screen, for
 * every case the camera cannot cover: permission refused (and on an installed
 * iOS web app that is genuinely hard to undo), no camera at all, or a child who
 * simply finds typing easier.
 *
 * The field is the ONLY place in the kid shell with a keyboard, and it is
 * forgiving on purpose: case, the dash, spaces and the classic misreadings
 * (`O` for zero, `I`/`l` for one) are all folded by `normalizeKidInviteCode`,
 * and a whole link pasted in from a message is reduced to the code inside it.
 */
export function KidCodeForm({
  onToken,
  onBack,
  onScan,
}: {
  onToken: (token: string) => void;
  onBack: () => void;
  /** Null when the camera is not on offer (it already failed). */
  onScan: (() => void) | null;
}) {
  const [code, setCode] = useState("");
  const ready = isKidInviteCode(code);

  function handleChange(raw: string) {
    // A pasted link (`.../kid/link#A7K29QXM`) becomes the code inside it, so a
    // parent can send the link in a message and the child can just paste.
    const fromLink = raw.includes("/kid/link") ? kidInviteTokenFromScan(raw) : null;
    if (fromLink && isKidInviteCode(fromLink)) {
      setCode(fromLink);
      return;
    }
    setCode(normalizeKidInviteCode(raw).slice(0, KID_INVITE_CODE_LENGTH));
  }

  return (
    <KidAuthScreen
      emoji="⌨️"
      title="Ukucaj kod"
      subtitle="osam znakova sa telefona roditelja"
      footer={
        <>
          Kod važi 15 minuta.
          <br />
          Ako je istekao, zamoli roditelja da napravi novi.
        </>
      }
    >
      <div className="mt-7 w-full max-w-[300px]">
        <label htmlFor="kid-invite-code" className="sr-only">
          Kod za povezivanje
        </label>
        <input
          id="kid-invite-code"
          value={formatKidInviteCode(code)}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ready) onToken(code);
          }}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCD-1234"
          aria-describedby="kid-invite-code-help"
          className="kid-on-gradient w-full rounded-[20px] bg-white/20 px-4 py-4 text-center text-[26px] font-bold tracking-[0.14em] text-white uppercase placeholder:text-white/45"
        />
        <p
          id="kid-invite-code-help"
          className="mt-2.5 text-center text-[12.5px] leading-relaxed font-normal opacity-90"
        >
          Roditelj ga vidi ispod QR koda, u tvom profilu.
        </p>

        <button
          type="button"
          onClick={() => onToken(code)}
          disabled={!ready}
          className="mt-5 w-full rounded-[18px] bg-white px-4 py-4 text-[17px] font-bold text-[var(--k-accent-strong)] shadow-[0_10px_24px_-10px_rgb(0_0_0/0.35)] transition-transform duration-100 not-disabled:active:scale-[0.96] disabled:opacity-55"
        >
          Poveži 🔗
        </button>

        {onScan ? (
          <button
            type="button"
            onClick={onScan}
            className="kid-on-gradient mt-2.5 w-full rounded-[18px] bg-white/15 px-4 py-3.5 text-[15px] font-semibold transition-transform duration-100 active:scale-[0.96]"
          >
            Skeniraj QR kod 📷
          </button>
        ) : null}

        <button
          type="button"
          onClick={onBack}
          className="kid-on-gradient mt-2.5 w-full rounded-[18px] px-4 py-3 text-[14px] font-semibold opacity-90 transition-transform duration-100 active:scale-[0.96]"
        >
          ← Nazad
        </button>
      </div>
    </KidAuthScreen>
  );
}
