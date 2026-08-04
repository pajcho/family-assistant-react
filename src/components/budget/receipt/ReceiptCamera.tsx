import { useCallback, useEffect, useRef, useState } from "react";
import { BoltIcon, VideoCameraSlashIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import { isSufReceiptUrl } from "@/hooks/useReceiptImport";
import { decodeQrFromImageData, getBarcodeDetector } from "./receiptQr";

/**
 * Live QR scanner for a fiscal receipt. Opens the environment camera, draws a
 * scan-frame overlay, offers a torch toggle when the track supports it, and
 * polls frames (~10fps) through BarcodeDetector when available, else
 * zxing-wasm. On the first valid suf.purs.gov.rs QR it stops the camera and
 * calls `onDecode`.
 *
 * Camera-permission / availability problems are non-fatal here: the component
 * renders an explanatory state, and the parent always shows the paste-link and
 * upload-image fallbacks alongside it.
 */

type CameraState = "starting" | "streaming" | "denied" | "unavailable";

export type ReceiptCameraProps = {
  /** Called once with a validated suf.purs.gov.rs URL. */
  onDecode: (url: string) => void;
  /** Pause scanning (e.g. while a previous decode is being imported). */
  paused?: boolean;
};

// Torch and focusMode live on MediaTrackConstraints in some browsers but not
// in lib.dom.
interface ExtendedCapabilities {
  torch?: boolean;
  focusMode?: string[];
}

export function ReceiptCamera({ onDecode, paused = false }: ReceiptCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const decodedRef = useRef(false);
  const pausedRef = useRef(paused);

  const [state, setState] = useState<CameraState>("starting");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleRaw = (raw: string) => {
      if (decodedRef.current) return;
      const value = raw.trim();
      if (!isSufReceiptUrl(value)) {
        setHint("Ovo nije QR kod fiskalnog računa.");
        return;
      }
      decodedRef.current = true;
      stopStream();
      onDecode(value);
    };

    const scanFrame = async (detector: Awaited<ReturnType<typeof getBarcodeDetector>>) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || pausedRef.current) return false;

      if (detector) {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            handleRaw(codes[0].rawValue);
            return decodedRef.current;
          }
        } catch {
          /* transient detect error - try again next tick */
        }
        return false;
      }

      // zxing-wasm fallback: sample only the centre square of the frame - the
      // viewport renders the video with object-cover, so that region covers
      // the scan frame the user aims with (and 2-4× fewer pixels to decode).
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return false;
      const side = Math.min(w, h);
      const sx = (w - side) / 2;
      const sy = (h - side) / 2;
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);
      const raw = await decodeQrFromImageData(ctx.getImageData(0, 0, side, side));
      if (raw) {
        handleRaw(raw);
        return decodedRef.current;
      }
      return false;
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            // Without explicit size hints iOS Safari defaults to 640×480 -
            // far too coarse for dense fiscal QR codes (~2-3px per module).
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as ExtendedCapabilities;
        setTorchAvailable(Boolean(caps.torch));
        if (track && caps.focusMode?.includes("continuous")) {
          // Keep hunting focus at receipt distance where the browser supports it.
          track
            .applyConstraints({
              advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
            })
            .catch(() => {});
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setState("streaming");

        const detector = await getBarcodeDetector();
        const loop = async () => {
          if (cancelled) return;
          const done = await scanFrame(detector);
          if (cancelled || done) return;
          timer = setTimeout(() => void loop(), 100); // ~10fps
        };
        void loop();
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopStream();
    };
  }, [onDecode, stopStream]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn((v) => !v);
    } catch {
      setTorchAvailable(false);
    }
  };

  if (state === "denied" || state === "unavailable") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted px-4 py-8 text-center">
        <VideoCameraSlashIcon className="size-8 text-muted-foreground" />
        <p className="text-sm font-bold text-foreground">
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[12.5px] font-bold text-white/85">
          Uključujem kameru…
        </div>
      ) : null}

      {hint ? (
        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-[12.5px] font-bold text-white/85">
          {hint}
        </div>
      ) : null}

      {torchAvailable ? (
        <button
          type="button"
          onClick={() => void toggleTorch()}
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
