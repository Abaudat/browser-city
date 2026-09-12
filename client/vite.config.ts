import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  // client/tests holds Vitest and Playwright specs, never served or bundled.
  // Bound to the IPv4 loopback explicitly: Node's default "localhost"
  // binding is IPv6-only on some hosts, and the e2e harness always dials
  // 127.0.0.1.
  server: {
    host: "127.0.0.1",
    fs: {
      strict: true,
      // The story 1.6 demo scene reads real LimeZu sprites straight out of
      // the repo-root `ModernTileset/` (Artie's direction: no new PNGs, no
      // copy into `public/`) via `new URL(..., import.meta.url)` asset
      // imports -- Vite still needs the dev server's own fs guard widened
      // to let those responses through.
      allow: [".", "../ModernTileset"],
    },
  },
  preview: {
    host: "127.0.0.1",
  },
});
