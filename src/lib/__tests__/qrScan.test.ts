import { describe, expect, it } from "vitest";
import { fillPrintStreaks, paperBounds } from "../qrScan";

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

describe("fillPrintStreaks", () => {
  // A 35px code of 5 modules: 7px modules, so a streak window of 5px.
  const upright = {
    topLeft: { x: 30, y: 30 },
    topRight: { x: 65, y: 30 },
    bottomRight: { x: 65, y: 65 },
    bottomLeft: { x: 30, y: 65 },
  };
  // The same code turned 90° clockwise: its horizontal now runs down the image.
  const turned = {
    topLeft: { x: 65, y: 30 },
    topRight: { x: 65, y: 65 },
    bottomRight: { x: 30, y: 65 },
    bottomLeft: { x: 30, y: 30 },
  };
  const level = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
    img.data[(y * img.width + x) * 4];

  it("fills a streak along the code's vertical and keeps a one-module gap open", () => {
    const img = image(100, 100, [
      [0, 0, 100, 100, 240], // light paper
      [30, 30, 7, 7, 0], // dark module...
      [33, 30, 1, 7, 240], // ...with a 1px printhead streak down through it
      [44, 30, 7, 7, 0], // next dark module, one light module to the right
    ]);
    const out = fillPrintStreaks(img, upright, 5);
    // Cropped with a 4-module (28px) quiet zone: x/y 2..92.
    expect(out.width).toBe(91);
    expect(out.height).toBe(91);
    expect(level(out, 33 - 2, 33 - 2)).toBe(0);
    expect(level(out, 38 - 2, 33 - 2)).toBe(240);
  });

  it("fills across the image's vertical when the code is turned sideways", () => {
    const img = image(100, 100, [
      [0, 0, 100, 100, 240],
      [30, 30, 7, 7, 0],
      [30, 33, 7, 1, 240], // the streak now runs across the image
      [30, 44, 7, 7, 0],
    ]);
    const out = fillPrintStreaks(img, turned, 5);
    expect(level(out, 33 - 2, 33 - 2)).toBe(0);
    expect(level(out, 33 - 2, 38 - 2)).toBe(240);
  });
});
