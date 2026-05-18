import {
  combinePresetAndAppleSplashScreens,
  createAppleSplashScreens,
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

/**
 * The default `minimal2023Preset` adds 30% white padding around the apple
 * touch icon (so on a dark home screen wallpaper you'd see a white square
 * around our blue tile). Override to fill the full 180×180 with our brand
 * blue — iOS applies its own rounded-corner mask on top, so the result
 * matches the rounding of native app icons.
 */
const preset = {
  ...minimal2023Preset,
  apple: {
    sizes: [180],
    padding: 0,
    resizeOptions: { background: "#2563EB", fit: "contain" as const },
  },
};

/**
 * PWA asset pipeline.
 *
 * Source: `public/pwa-icon.svg` — a *square* version of the brand icon
 * (no rounded corners on the background) because iOS applies its own mask
 * to `apple-touch-icon`, and Android's adaptive icons mask the maskable
 * variant. The existing `public/favicon.svg` keeps its rounded corners and
 * is used unchanged for the browser tab.
 *
 * Run: `pnpm exec pwa-assets-generator` to regenerate all PNGs into public/.
 */
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: combinePresetAndAppleSplashScreens(
    preset,
    createAppleSplashScreens(
      {
        padding: 0.3,
        resizeOptions: { background: "#2563EB", fit: "contain" },
        darkResizeOptions: { background: "#111827", fit: "contain" },
        linkMediaOptions: { log: true, addMediaScreen: true, basePath: "/", xhtml: false },
        png: { compressionLevel: 9, quality: 60 },
      },
      // Covers iPhone 6+ / SE / X / XR / 11 / 12 / 13 / 14 / 15 / 16 lines
      // (mini, regular, Plus/Max, Pro Max). The generator knows the sizes.
      [
        'iPad Air 9.7"',
        'iPad Pro 10.5"',
        'iPad Pro 11"',
        'iPad Pro 12.9"',
        "iPhone 14 Pro Max",
        "iPhone 14 Pro",
        "iPhone 14 Plus",
        "iPhone 14",
        "iPhone 13 Pro Max",
        "iPhone 13 Pro",
        "iPhone 13",
        "iPhone 13 mini",
        "iPhone 11 Pro Max",
        "iPhone 11 Pro",
        "iPhone 11",
        "iPhone XS Max",
        "iPhone XS",
        "iPhone XR",
        "iPhone X",
        "iPhone 8 Plus",
        "iPhone 8",
      ],
    ),
  ),
  images: ["public/pwa-icon.svg"],
});
