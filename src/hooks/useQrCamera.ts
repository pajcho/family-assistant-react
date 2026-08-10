import { useCallback, useEffect, useRef, useState } from "react";

import { decodeQrFromImageData, getBarcodeDetector } from "@/lib/qrScan";

/**
 * The live half of a QR scanner: opens the environment camera, polls frames at
 * ~10fps through BarcodeDetector where it exists and zxing-wasm everywhere
 * else, and stops the moment the caller accepts a payload.
 *
 * Shared by the two scanners in the app - fiscal receipts in the grown-up app
 * and device linking in the kid shell - which look nothing alike but need
 * exactly the same camera handling, including the iOS-specific parts that took
 * a device to get right (explicit resolution hints, `playsInline`, continuous
 * focus where the browser offers it).
 *
 * What stays with the CALLER is what to do with a decoded string: this hook
 * hands over every payload it reads and only stops when `onDecode` returns
 * true, so "that was a QR code, just not the one you're looking for" is the
 * caller's message to write.
 */

export type QrCameraState = "starting" | "streaming" | "denied" | "unavailable";

// Torch and focusMode live on MediaTrackConstraints in some browsers but not
// in lib.dom.
interface ExtendedCapabilities {
  torch?: boolean;
  focusMode?: string[];
}

export interface UseQrCameraOptions {
  /**
   * Every decoded payload lands here. Return true to accept it - the camera
   * stops and nothing else is read - or false to keep scanning.
   *
   * Held in a ref, so a caller may pass an inline closure without restarting
   * the camera on every render.
   */
  onDecode: (raw: string) => boolean;
  /** Stop reading frames without releasing the camera (e.g. while importing). */
  paused?: boolean;
}

export interface QrCamera {
  /** Attach to a `<video playsInline muted>`. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: QrCameraState;
  /** True only where the track actually exposes a torch (Android, mostly). */
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
}

export function useQrCamera({ onDecode, paused = false }: UseQrCameraOptions): QrCamera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const decodedRef = useRef(false);
  const pausedRef = useRef(paused);
  const onDecodeRef = useRef(onDecode);

  const [state, setState] = useState<QrCameraState>("starting");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

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
      if (!onDecodeRef.current(raw.trim())) return;
      decodedRef.current = true;
      stopStream();
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
  }, [stopStream]);

  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    track
      .applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      .then(() => setTorchOn((on) => !on))
      .catch(() => setTorchAvailable(false));
  }, [torchOn]);

  return { videoRef, state, torchAvailable, torchOn, toggleTorch };
}
