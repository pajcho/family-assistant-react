import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  // Dev serves at `/`; production build + `vite preview` use the GH Pages
  // base path, mirroring the original Nuxt app's NUXT_APP_BASE_URL pattern.
  // `mode` is "production" for both `vite build` and `vite preview`, so
  // running preview locally exercises the exact base-path behaviour GH
  // Pages will see — unlike `command`, which would be "serve" in preview.
  base: mode === "production" ? "/family-assistant-react/" : "/",
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
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
      // — vite-plugin-pwa resolves them relative to `base` at build time.
      manifest: {
        name: "Porodični Asistent",
        short_name: "Porodicni Asistent",
        description: "Porodični kalendar, plaćanja i podsetnici",
        theme_color: "#2563eb",
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
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        // Splash screens are huge (~30MB total) and only used at native
        // launch time from the home-screen icon — caching them via SW would
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
}));
