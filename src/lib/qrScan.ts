// QR decoding, shared by the two scanners in the app: fiscal receipts in the
// grown-up app, and device linking in the kid shell. zxing-wasm is imported
// dynamically so it only ships in the lazy chunk that opens a scanner, never in
// the main bundle - which is also why this module must stay free of any import
// that would drag it into that bundle.
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
    const full = ctx.getImageData(0, 0, width, height);
    const decoded = await decodeQrFromImageData(full);
    if (decoded) return decoded;

    // A receipt shown on a dark screen (a screenshot of a receipt image) often
    // has the QR running edge to edge of the paper, so its finder patterns
    // touch the dark background and lose their quiet zone. Cropping to the
    // paper puts the QR against the image border, which ZXing does accept.
    const paper = paperBounds(full);
    if (!paper || (paper.width === width && paper.height === height)) return null;
    return await decodeQrFromImageData(
      ctx.getImageData(paper.x, paper.y, paper.width, paper.height),
    );
  } finally {
    bitmap.close();
  }
}

/**
 * Bounding box of the receipt paper in an image of a receipt against a darker
 * background. The paper is found as bright (luma above an Otsu threshold),
 * 4-connected areas: the largest one, merged with every other large one in the
 * same columns, because the separator rules printed across a fiscal receipt
 * cut its paper into stacked pieces. Returns null for an empty image.
 */
export function paperBounds(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } | null {
  const { data, width, height } = image;
  const size = width * height;
  if (size === 0) return null;

  const luma = new Uint8Array(size);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < size; i++) {
    const v = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    luma[i] = v;
    histogram[luma[i]]++;
  }

  // Otsu: the threshold that maximizes the between-class variance.
  let total = 0;
  for (let v = 0; v < 256; v++) total += v * histogram[v];
  let threshold = 127;
  let best = -1;
  let countBelow = 0;
  let sumBelow = 0;
  for (let v = 0; v < 256; v++) {
    countBelow += histogram[v];
    if (countBelow === 0 || countBelow === size) continue;
    sumBelow += v * histogram[v];
    const meanBelow = sumBelow / countBelow;
    const meanAbove = (total - sumBelow) / (size - countBelow);
    const variance = countBelow * (size - countBelow) * (meanBelow - meanAbove) ** 2;
    if (variance > best) {
      best = variance;
      threshold = v;
    }
  }

  const visited = new Uint8Array(size);
  const stack = new Int32Array(size);
  const regions: Array<{ count: number; minX: number; minY: number; maxX: number; maxY: number }> =
    [];
  let top = 0;
  const push = (n: number) => {
    if (!visited[n] && luma[n] > threshold) {
      visited[n] = 1;
      stack[top++] = n;
    }
  };
  for (let start = 0; start < size; start++) {
    if (visited[start] || luma[start] <= threshold) continue;
    push(start);
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }
    regions.push({ count, minX, minY, maxX, maxY });
  }
  if (regions.length === 0) return null;

  const largest = regions.reduce((a, b) => (b.count > a.count ? b : a));
  let { minX, minY, maxX, maxY } = largest;
  for (const r of regions) {
    if (r.count * 4 < largest.count || r.maxX < largest.minX || r.minX > largest.maxX) continue;
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
