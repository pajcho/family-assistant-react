import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

import {
  applyKidInstallIdentityToDom,
  buildKidManifest,
  isKidInstallPath,
  kidInstallIdentity,
  KID_MANIFEST_FILE,
  // Extension spelled out for Vite's future native config loader, which cannot
  // resolve an extensionless TS import.
} from "./src/lib/kidInstallIdentity.ts";

/** Where `index.html` wants the dečiji režim bootstrap script. */
const KID_BOOTSTRAP_MARKER = "<!-- kid-install-identity-bootstrap -->";

/**
 * Dečiji režim install identity, the two halves the build owns.
 *
 * 1. `kid.webmanifest` is GENERATED rather than kept in `public/`, because its
 *    `id`, `start_url` and `scope` have to carry the base path - `/` in dev,
 *    `/family-assistant-react/` on Pages - and `id` in particular is resolved
 *    against the ORIGIN of `start_url`, so no relative spelling is correct in
 *    both. See `buildKidManifest`.
 * 2. The `index.html` bootstrap: an inline, synchronous script that puts the
 *    kid manifest, favicon, apple-touch-icon and apple title on the document
 *    while it is still parsing, if the URL is a kid one. It is the same code
 *    `useKidInstallIdentity` runs, stringified - see `src/lib/kidInstallIdentity.ts`
 *    for why doing this from React is always too late for a first visit.
 *
 * The script is inserted at a marker rather than appended, because it has to sit
 * AFTER the icon/title tags it rewrites (they must already be parsed) and BEFORE
 * vite-plugin-pwa's `<link rel="manifest">`, which lands at the end of `<head>`.
 */
function kidInstallIdentityPlugin(base: string): Plugin {
  const manifest = `${JSON.stringify(buildKidManifest(base), null, 2)}\n`;
  const manifestUrl = `${base}${KID_MANIFEST_FILE}`;

  const bootstrap = [
    "<script>",
    "      // Dečiji režim: wear the kid app's install identity from the very",
    '      // first paint, so "Add to Home Screen" on a fresh /kid/* visit',
    "      // installs the child's app and not a duplicate of the parent's.",
    "      // Generated in vite.config.ts from src/lib/kidInstallIdentity.ts.",
    "      (function () {",
    "        try {",
    `          var isKidInstallPath = ${isKidInstallPath.toString()};`,
    `          var applyKidInstallIdentityToDom = ${applyKidInstallIdentityToDom.toString()};`,
    `          if (isKidInstallPath(location.pathname, ${JSON.stringify(base)})) {`,
    `            applyKidInstallIdentityToDom(true, ${JSON.stringify(kidInstallIdentity(base))});`,
    "          }",
    "        } catch (_) {}",
    "      })();",
    "    </script>",
  ].join("\n");

  return {
    name: "kid-install-identity",

    // `public/` would have served this for free, but only as a static file.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split("?")[0] !== manifestUrl) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(manifest);
      });
    },

    generateBundle() {
      this.emitFile({ type: "asset", fileName: KID_MANIFEST_FILE, source: manifest });
    },

    transformIndexHtml: {
      // Before Vite and vite-plugin-pwa inject their own tags, so the marker is
      // still where index.html put it.
      order: "pre",
      handler(html, ctx) {
        if (html.includes(KID_BOOTSTRAP_MARKER))
          return html.replace(KID_BOOTSTRAP_MARKER, bootstrap);
        // Losing the marker in the app's entry has to fail loudly - it would
        // silently hand the kid app back to the parent's identity. Any other
        // HTML the dev server happens to serve (scratch pages in `public/`) is
        // none of this plugin's business.
        if (ctx.filename.endsWith("index.html")) {
          throw new Error(
            `index.html is missing the "${KID_BOOTSTRAP_MARKER}" marker - the dečiji režim install identity would silently fall back to the parent app.`,
          );
        }
        return html;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // Dev serves at `/`; production build + `vite preview` use the GH Pages
  // base path, mirroring the original Nuxt app's NUXT_APP_BASE_URL pattern.
  // `mode` is "production" for both `vite build` and `vite preview`, so
  // running preview locally exercises the exact base-path behaviour GH
  // Pages will see - unlike `command`, which would be "serve" in preview.
  const base = mode === "production" ? "/family-assistant-react/" : "/";

  return {
    base,
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      }),
      react(),
      tailwindcss(),
      kidInstallIdentityPlugin(base),
      VitePWA({
        // injectManifest lets us own `src/sw.ts` so we can add `push` /
        // `notificationclick` handlers later without migrating off generateSW.
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "prompt",
        injectRegister: false,
        // `start_url: "."` and `scope: "."` keep the manifest portable between
        // dev (`/`) and the GH Pages base path (`/family-assistant-react/`)
        // - vite-plugin-pwa resolves them relative to `base` at build time.
        manifest: {
          // The app's identity to the browser, and what separates this install
          // from the dečiji režim one (`kid.webmanifest`). Spelled out rather
          // than left to default so a later `start_url` change cannot orphan
          // every home-screen tile; the value is exactly what the default
          // resolves to today, because `id` is parsed against the ORIGIN.
          id: base,
          name: "Porodični Asistent",
          short_name: "Porodicni Asistent",
          description: "Porodični kalendar, plaćanja i podsetnici",
          theme_color: "#f4f1f6",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          start_url: ".",
          scope: ".",
          lang: "sr",
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "maskable-icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        injectManifest: {
          // `wasm` covers the zxing-wasm QR decoder (~1MB) so the scanner works
          // instantly and offline once the SW has precached it. `webmanifest`
          // covers the generated grown-up manifest AND the generated
          // `kid.webmanifest`, the dečiji režim install identity - narrow this
          // pattern and the kid icons stop being available offline.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,wasm}"],
          // Splash screens are huge (~30MB total) and only used at native
          // launch time from the home-screen icon - caching them via SW would
          // bloat the precache without speeding anything up.
          globIgnores: ["**/apple-splash-*.png"],
        },
        devOptions: {
          enabled: true,
          type: "module",
          navigateFallback: "index.html",
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      // PORT lets tooling (e.g. the Claude Code preview harness) assign a free
      // port when 5173 is already taken by another dev-server instance.
      port: process.env.PORT ? Number(process.env.PORT) : 5173,
    },
  };
});
