import { describe, expect, it } from "vitest";
import { paperBounds } from "../qrScan";

/** A dark gray RGBA image with the given rectangles painted in a flat gray level. */
function image(
  width: number,
  height: number,
  rects: Array<[number, number, number, number, number]>,
) {
  const data = new Uint8ClampedArray(width * height * 4).fill(20);
  for (const [x0, y0, w, h, level] of rects) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        data.set([level, level, level, 255], (y * width + x) * 4);
      }
    }
  }
  return { data, width, height };
}

describe("paperBounds", () => {
  it("finds a receipt cut into pieces by full-width separator rules", () => {
    const img = image(100, 80, [
      [30, 10, 40, 60, 250], // the paper
      [30, 25, 40, 2, 0], // separator rule across the whole paper (small header above)
      [30, 30, 15, 15, 0], // QR finder touching the paper's left edge
      [5, 5, 10, 8, 240], // unrelated bright spot outside the paper
    ]);
    expect(paperBounds(img)).toEqual({ x: 30, y: 10, width: 40, height: 60 });
  });
});
