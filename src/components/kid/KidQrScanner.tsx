import { useCallback, useState } from "react";

import { useQrCamera } from "@/hooks/useQrCamera";
import { kidInviteTokenFromScan } from "@/types/kid";

/**
 * "Skeniraj QR kod" - the child's own camera, pointed at the code on a parent's
 * screen.
 *
 * This is not a convenience, it is the only way into the INSTALLED app on iOS.
 * A home-screen web app has its own storage container and Safari never hands it
 * a scanned URL, so a code scanned with the iOS Camera app always lands in
 * Safari, and whatever it links there is invisible to the app on the home
 * screen. Scanning from in here puts the device token where the installed app
 * will actually look for it.
 *
 * Full screen and black, unlike everything else in the kid shell: a camera
 * viewport wants no gradient behind it, and the child is aiming at something.
 *
 * Lives behind `lazyKidQrScanner` - it pulls in zxing-wasm (iOS has no
 * BarcodeDetector), which must not sit in the shell's first load.
 */
export function KidQrScanner({
  onToken,
  onBack,
  onTypeCode,
}: {
  /** A device-link token read off a QR code. */
  onToken: (token: string) => void;
  onBack: () => void;
  /**
   * Switch to typing the code. `cameraWorks` is false when the camera never
   * started (refused, or none at all), so the code screen knows not to offer
   * scanning as a way back.
   */
  onTypeCode: (cameraWorks: boolean) => void;
}) {
  const [hint, setHint] = useState<string | null>(null);

  const handleDecode = useCallback(
    (raw: string) => {
      const token = kidInviteTokenFromScan(raw);
      if (!token) {
        setHint("Ovo nije kod za povezivanje. Traži od roditelja QR iz aplikacije.");
        return false;
      }
      onToken(token);
      return true;
    },
    [onToken],
  );

  const { videoRef, state } = useQrCamera({ onDecode: handleDecode });
  const blocked = state === "denied" || state === "unavailable";

  return (
    <div className="kid-font relative flex h-[100dvh] w-full flex-col bg-black text-white">
      <div className="relative z-10 flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="kid-on-gradient rounded-full bg-white/15 px-4 py-2 text-[14px] font-semibold transition-transform duration-100 active:scale-[0.94]"
        >
          ← Nazad
        </button>
        <p className="flex-1 pr-[86px] text-center text-[15px] font-bold">Skeniraj kod</p>
      </div>

      {blocked ? (
        <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
          <span aria-hidden="true" className="text-[54px] leading-none">
            📷
          </span>
          <p className="mt-3 text-[17px] font-bold">
            {state === "denied" ? "Kamera nije dozvoljena" : "Kamera ne radi ovde"}
          </p>
          <p className="mt-2 max-w-[280px] text-[13.5px] leading-relaxed font-normal text-white/80">
            Ništa strašno - roditelj ti pored QR koda vidi i kod od osam znakova. Ukucaj ga i to je
            to.
          </p>
          <button
            type="button"
            onClick={() => onTypeCode(false)}
            className="mt-6 w-full max-w-[300px] rounded-[18px] bg-white px-4 py-4 text-[16px] font-bold text-[var(--k-accent-strong)] transition-transform duration-100 active:scale-[0.96]"
          >
            Ukucaj kod ⌨️
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              className="size-full object-cover"
              playsInline
              muted
              aria-label="Prikaz kamere za skeniranje koda"
            />

            {/* Scan frame. Same shape as the receipt scanner's, sized for a code
                held up on another phone rather than a printed receipt. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative aspect-square w-[68%] max-w-[300px]">
                <span className="absolute top-0 left-0 size-9 rounded-tl-2xl border-t-[3px] border-l-[3px] border-white" />
                <span className="absolute top-0 right-0 size-9 rounded-tr-2xl border-t-[3px] border-r-[3px] border-white" />
                <span className="absolute bottom-0 left-0 size-9 rounded-bl-2xl border-b-[3px] border-l-[3px] border-white" />
                <span className="absolute right-0 bottom-0 size-9 rounded-br-2xl border-r-[3px] border-b-[3px] border-white" />
              </div>
            </div>

            {state === "starting" ? (
              <div className="absolute inset-0 grid place-items-center bg-black/50 text-[14px] font-semibold text-white/90">
                Palim kameru...
              </div>
            ) : null}
          </div>

          <div className="px-6 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center">
            <p role="status" className="text-[13.5px] leading-relaxed font-normal text-white/85">
              {hint ?? "Uperi kameru u QR kod na telefonu mame ili tate."}
            </p>
            <button
              type="button"
              onClick={() => onTypeCode(true)}
              className="kid-on-gradient mt-3 w-full max-w-[300px] rounded-[18px] bg-white/15 px-4 py-3.5 text-[15px] font-semibold transition-transform duration-100 active:scale-[0.96]"
            >
              Ukucaj kod umesto skeniranja ⌨️
            </button>
          </div>
        </>
      )}
    </div>
  );
}
