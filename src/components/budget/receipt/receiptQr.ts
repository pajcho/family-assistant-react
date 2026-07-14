// QR decoding helpers for the receipt scanner. jsQR is imported dynamically so
// it only ships in the lazy ReceiptScanDialog chunk, never the main bundle.
//
// Two decode paths:
//   • BarcodeDetector (native, fast) when the browser exposes it — used for the
//     live camera loop.
//   • jsQR (WASM-free JS fallback) for browsers without BarcodeDetector and for
//     decoding a still image the user uploaded.

/** Minimal shape of the (not-yet-in-lib.dom) BarcodeDetector API we rely on. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Returns a QR-capable BarcodeDetector, or null when unsupported. */
export async function getBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    if (Ctor.getSupportedFormats) {
      const formats = await Ctor.getSupportedFormats();
      if (!formats.includes("qr_code")) return null;
    }
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/** Decodes a QR code from raw pixel data via jsQR. Returns the payload or null. */
export async function decodeQrFromImageData(data: ImageData): Promise<string | null> {
  const { default: jsQR } = await import("jsqr");
  const result = jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
  return result?.data ?? null;
}

/**
 * Decodes a QR code from an uploaded image file. Large photos are scaled down
 * (keeps jsQR fast) before sampling. Returns the payload or null.
 */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return await decodeQrFromImageData(imageData);
  } finally {
    bitmap.close();
  }
}
