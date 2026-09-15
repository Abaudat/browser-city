import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// Story 1.14 cycle 3 (Quentin's direction): `vite preview` serves plain
// HTTP/1.1 by default, which queues the boot-budget spike's ~105 image
// requests behind six connections per origin -- a preview-server artefact
// GitHub Pages (HTTP/2, one multiplexed connection) never pays. Setting
// BC_BOOT_HTTPS=1 (scripts/dev/run-boot-budget-spike.sh's own job, never a
// developer's `npm run dev`/`npm run preview`) turns on a throwaway
// self-signed cert so `vite preview` negotiates HTTP/2 like the real host
// does -- `compute-terms.mjs` asserts every image response actually
// negotiated `h2` and throws otherwise, so a silent fallback to HTTP/1.1
// can never reach the report.
const bootHttps = process.env.BC_BOOT_HTTPS === "1";

export default defineConfig({
  root: ".",
  plugins: bootHttps ? [basicSsl()] : [],
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
    https: bootHttps,
  },
});
