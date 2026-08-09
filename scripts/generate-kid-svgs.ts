/**
 * Generates the two DERIVED kid SVGs from `public/kid-icon.svg`, the one
 * hand-authored kid artwork:
 *
 * - `public/kid-favicon.svg` - the browser-tab icon. Same tile, but rounding
 *   its own corners: iOS and Android mask the home-screen icon themselves, a
 *   tab does not. `public/favicon.svg` rounds the grown-up 32px tile by 7px, so
 *   the same 7/32 ratio is used here and the two tabs read as one family.
 * - `public/kid-mark.svg` - the mark on the sign-in screens. Same drawing with
 *   the tile background dropped and cropped to `data-mark-viewbox`: that screen
 *   is already the tile colour, so a tile on it would be an invisible square
 *   with visible empty margins.
 *
 * Run:  pnpm assets:kid   (regenerates the kid PNGs too, which is the point:
 *                          replace `public/kid-icon.svg` and one command
 *                          rebuilds every kid asset from it)
 *
 * Both outputs are transforms of the source rather than copies of its shapes,
 * which is what keeps them artwork-agnostic: whatever the next `kid-icon.svg`
 * draws, it gets the same corners and the same crop. The two attributes that
 * drive it are documented in the source itself; missing either one throws here
 * rather than silently shipping a mark with a background baked into it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(root, "public/kid-icon.svg");
const FAVICON_OUTPUT = path.join(root, "public/kid-favicon.svg");
const MARK_OUTPUT = path.join(root, "public/kid-mark.svg");

/** `public/favicon.svg`: a 32x32 tile with rx="7". */
const CORNER_RATIO = 7 / 32;

const GENERATED_NOTE =
  "<!-- GENERATED from public/kid-icon.svg by scripts/generate-kid-svgs.ts. Edit the source, then run `pnpm assets:kid`. -->";

const source = readFileSync(SOURCE, "utf8");

const openingTag = /<svg\b[^>]*>/i.exec(source)?.[0];
const closingIndex = source.lastIndexOf("</svg>");
if (!openingTag || closingIndex === -1) {
  throw new Error(`${SOURCE} does not look like an SVG file.`);
}

const attribute = (name: string): string | undefined =>
  new RegExp(`${name}="([^"]+)"`, "i").exec(openingTag)?.[1];

const viewBox = attribute("viewBox");
if (!viewBox) throw new Error(`${SOURCE} has no viewBox, so it cannot be clipped reliably.`);

const markViewBox = attribute("data-mark-viewbox");
if (!markViewBox) {
  throw new Error(
    `${SOURCE} has no data-mark-viewbox. It is the tight bounding box of the drawing, without the tile - see the comment in that file.`,
  );
}

const [minX, minY, width, height] = viewBox.trim().split(/\s+/).map(Number);
if ([minX, minY, width, height].some((value) => !Number.isFinite(value))) {
  throw new Error(`${SOURCE} has an unreadable viewBox: "${viewBox}"`);
}

// Comments in the source are notes to whoever draws the icon, not to whoever
// renders the tab, and a favicon is requested on every cold load.
const body = source
  .slice(source.indexOf(openingTag) + openingTag.length, closingIndex)
  .replace(/<!--[\s\S]*?-->/g, "");

/** Re-indent a body under one wrapping level, so a diff of the output reads. */
function reindent(markup: string, indent: string): string {
  const lines = markup.split("\n").filter((line) => line.trim());
  // Strip whatever indentation the source used - it is hand-authored, or
  // exported by a drawing tool, so it is not ours to assume.
  const outdent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
  return lines.map((line) => `${indent}${line.slice(outdent)}`).join("\n");
}

const radius = Math.round(Math.min(width, height) * CORNER_RATIO);

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none">
  ${GENERATED_NOTE}
  <defs>
    <clipPath id="kid-favicon-corners">
      <rect x="${minX}" y="${minY}" width="${width}" height="${height}" rx="${radius}" />
    </clipPath>
  </defs>
  <g clip-path="url(#kid-favicon-corners)">
${reindent(body, "    ")}
  </g>
</svg>
`;

writeFileSync(FAVICON_OUTPUT, favicon);
console.log(
  `kid-favicon: ${path.relative(root, FAVICON_OUTPUT)} (rx=${radius} on a ${width}x${height} tile)`,
);

// One self-closing element, matched by its attribute rather than by tag or
// position: the next artwork may paint its background with something other than
// a <rect>, and may not paint it first.
const tileBackground = /\s*<[a-z]+\b[^>]*\bdata-tile-background\b[^>]*\/>/i.exec(body)?.[0];
if (!tileBackground) {
  throw new Error(
    `${SOURCE} has no self-closing element marked data-tile-background, so the tile cannot be dropped from the mark - see the comment in that file.`,
  );
}

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${markViewBox}" fill="none">
  ${GENERATED_NOTE}
${reindent(body.replace(tileBackground, ""), "  ")}
</svg>
`;

writeFileSync(MARK_OUTPUT, mark);
console.log(`kid-mark:    ${path.relative(root, MARK_OUTPUT)} (viewBox "${markViewBox}", no tile)`);
