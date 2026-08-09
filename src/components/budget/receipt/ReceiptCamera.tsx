import { useCallback, useState } from "react";
import { BoltIcon, VideoCameraSlashIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import { isSufReceiptUrl } from "@/hooks/useReceiptImport";
import { useQrCamera } from "@/hooks/useQrCamera";

/**
 * Live QR scanner for a fiscal receipt: the camera and the scan loop come from
 * `useQrCamera`, and what this file adds is the receipt-specific part - the
 * scan-frame viewport, the torch button, and the rule that only a
 * suf.purs.gov.rs URL counts as a hit.
 *
 * Camera-permission / availability problems are non-fatal here: the component
 * renders an explanatory state, and the parent always shows the paste-link and
 * upload-image fallbacks alongside it.
 */

export type ReceiptCameraProps = {
  /** Called once with a validated suf.purs.gov.rs URL. */
  onDecode: (url: string) => void;
  /** Pause scanning (e.g. while a previous decode is being imported). */
  paused?: boolean;
};

export function ReceiptCamera({ onDecode, paused = false }: ReceiptCameraProps) {
  const [hint, setHint] = useState<string | null>(null);

  const handleDecode = useCallback(
    (raw: string) => {
      if (!isSufReceiptUrl(raw)) {
        setHint("Ovo nije QR kod fiskalnog računa.");
        return false;
      }
      onDecode(raw);
      return true;
    },
    [onDecode],
  );

  const { videoRef, state, torchAvailable, torchOn, toggleTorch } = useQrCamera({
    onDecode: handleDecode,
    paused,
  });

  if (state === "denied" || state === "unavailable") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted px-4 py-8 text-center">
        <VideoCameraSlashIcon className="size-8 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">
          {state === "denied" ? "Kamera nije dozvoljena" : "Kamera nije dostupna"}
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Zalepi link sa računa ili otpremi sliku QR koda ispod.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-[300px] w-full overflow-hidden rounded-2xl bg-[#17121C]">
      <video
        ref={videoRef}
        className="size-full object-cover"
        playsInline
        muted
        aria-label="Prikaz kamere za skeniranje računa"
      />

      {/* Scan-frame overlay with a subtle scanning line. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative aspect-square h-3/5">
          <span className="absolute top-0 left-0 size-6 rounded-tl-lg border-t-2 border-l-2 border-white/90" />
          <span className="absolute top-0 right-0 size-6 rounded-tr-lg border-t-2 border-r-2 border-white/90" />
          <span className="absolute bottom-0 left-0 size-6 rounded-bl-lg border-b-2 border-l-2 border-white/90" />
          <span className="absolute right-0 bottom-0 size-6 rounded-br-lg border-r-2 border-b-2 border-white/90" />
          {state === "streaming" ? (
            <span className="animate-scanline absolute inset-x-2 top-1/2 h-0.5 rounded-full bg-accent shadow-[0_0_14px_2px_var(--accent)]" />
          ) : null}
        </div>
      </div>

      {state === "starting" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[12.5px] font-semibold text-white/85">
          Uključujem kameru…
        </div>
      ) : null}

      {hint ? (
        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-[12.5px] font-semibold text-white/85">
          {hint}
        </div>
      ) : null}

      {torchAvailable ? (
        <button
          type="button"
          onClick={toggleTorch}
          aria-pressed={torchOn}
          aria-label={torchOn ? "Ugasi baterijsku lampu" : "Upali baterijsku lampu"}
          className={cn(
            "absolute top-3 right-3 flex size-11 items-center justify-center rounded-full backdrop-blur transition-colors",
            // Lit state uses warn-soft as the glyph: white vanishes on the
            // dark theme's lighter --warn.
            torchOn ? "bg-warn text-warn-soft" : "bg-black/50 text-white hover:bg-black/70",
          )}
        >
          <BoltIcon className="size-5" />
        </button>
      ) : null}
    </div>
  );
}
