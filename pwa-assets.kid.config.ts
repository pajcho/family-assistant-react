import { defineConfig } from "@vite-pwa/assets-generator/config";

/**
 * PWA asset pipeline for the DEČIJI REŽIM home-screen identity.
 *
 * A second config rather than a second entry in `pwa-assets.config.ts`: the
 * generator names every output from a preset-wide `assetName`, so one config
 * cannot emit two differently-named sets from two sources.
 *
 *   pnpm assets:kid
 *
 * is the ONE command that rebuilds every kid asset: this generator's PNGs plus
 * `public/kid-favicon.svg` and `public/kid-mark.svg`
 * (`scripts/generate-kid-svgs.ts`). Replacing the artwork is therefore
 * "overwrite `public/kid-icon.svg`, run that command" - nothing else
 * references the drawing.
 *
 * Source: `public/kid-icon.svg` - square, full-bleed, with every mark inside
 * the middle ~73% so Android's circular maskable crop never clips the tree.
 *
 * Deliberately NOT here:
 * - `favicons`, which would overwrite the app-wide `public/favicon.ico` and
 *   `public/favicon.svg`; the kid tab icon comes from the script above, which
 *   only rounds the corners of this same source;
 * - apple splash screens, ~30MB for a set iOS only uses at launch. Without
 *   them iOS falls back to the manifest `background_color`, which is exactly
 *   the tile colour, so the launch reads as one solid violet screen.
 */

/** The tile colour of `public/kid-icon.svg`. Keep the three in sync. */
const KID_TILE = "#443591";

/**
 * Distinct filenames so nothing collides with the grown-up set
 * (`pwa-*.png` / `maskable-icon-*.png` / `apple-touch-icon-*.png`).
 */
const KID_ASSET_PREFIX = {
  transparent: "kid",
  maskable: "kid-maskable",
  apple: "kid-apple-touch-icon",
};

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    // 64 is skipped: it exists in the grown-up set only to be turned into
    // favicon.ico, and the kid tab icon is an SVG (`kid-favicon.svg`).
    transparent: { sizes: [192, 512], padding: 0.05 },
    // padding 0 (the generator default is 0.3 on white) because the source
    // already reserves the safe zone - so the whole masked circle is teal
    // instead of a small teal square floating on a white disc.
    maskable: {
      sizes: [512],
      padding: 0,
      resizeOptions: { background: KID_TILE, fit: "contain" as const },
    },
    // Same reasoning as the grown-up config: fill the full 180x180 with the
    // tile colour, iOS lays its own rounded-corner mask over the top.
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: KID_TILE, fit: "contain" as const },
    },
    assetName: (type, size) => `${KID_ASSET_PREFIX[type]}-${size.width}x${size.height}.png`,
  },
  images: ["public/kid-icon.svg"],
});
