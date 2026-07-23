// QR decoding helpers for the receipt scanner. zxing-wasm is imported
// dynamically so it only ships in the lazy ReceiptScanDialog chunk, never the
// main bundle.
//
// Two decode paths:
//   • BarcodeDetector (native, fast) when the browser exposes it - used for the
//     live camera loop and as a first pass on uploaded images. iOS Safari has
//     no BarcodeDetector, so iPhones never take this path.
//   • zxing-wasm (ZXing C++ compiled to WASM) everywhere else. Far stronger
//     than the old jsQR on dense fiscal QR codes, low light, blur and skew.

/** Minimal shape of the (not-yet-in-lib.dom) BarcodeDetector API we rely on. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | ImageBitmap): Promise<Array<{ rawValue: string }>>;
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

type ZXingReader = typeof import("zxing-wasm/reader");

let zxingLoader: Promise<ZXingReader> | null = null;

/**
 * Loads the zxing-wasm reader once. The .wasm binary is served from our own
 * origin (Vite asset, precached by the SW) instead of the library's default
 * jsDelivr CDN, so scanning works without third-party requests.
 */
async function loadZXing(): Promise<ZXingReader> {
  zxingLoader ??= Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]).then(([mod, wasm]) => {
    mod.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? wasm.default : prefix + path,
      },
    });
    return mod;
  });
  return zxingLoader;
}

/** Decodes a QR code from raw pixel data via zxing-wasm. Returns the payload or null. */
export async function decodeQrFromImageData(data: ImageData): Promise<string | null> {
  const { readBarcodes } = await loadZXing();
  const results = await readBarcodes(data, { formats: ["QRCode"], tryHarder: true });
  return results[0]?.text ?? null;
}

/**
 * Decodes a QR code from an uploaded image file. Tries the native detector
 * first when available (free on Chrome/Android), then zxing-wasm on a
 * high-resolution sample - dense fiscal QR codes often only resolve near full
 * resolution, and ZXing's own tryDownscale covers the smaller scales in the
 * same call. Returns the payload or null.
 */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const detector = await getBarcodeDetector();
    if (detector) {
      try {
        const codes = await detector.detect(bitmap);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      } catch {
        /* fall through to zxing-wasm */
      }
    }

    const maxDim = 3072;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await decodeQrFromImageData(ctx.getImageData(0, 0, width, height));
  } finally {
    bitmap.close();
  }
}
