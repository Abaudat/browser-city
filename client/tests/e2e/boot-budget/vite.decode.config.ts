// Story 1.14 (D4): builds *only* `decode-harness.html` -- never
// `index.html`, never invoked by `npm run build` or `npm run dev`. Its own
// `root` and `outDir`, both outside `client/dist`, so the decode harness
// (and its generated bindings) can never land in the artefact
// `client-build`'s "no spike code reaches dist" check inspects.
// `scripts/dev/run-boot-budget-spike.sh` is the only caller:
//   vite build --config tests/e2e/boot-budget/vite.decode.config.ts
//   vite preview --config tests/e2e/boot-budget/vite.decode.config.ts --port <port>
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "tests/e2e/boot-budget",
  build: {
    outDir: "../../../dist-boot-budget-decode",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "decode-harness.html"),
    },
  },
  server: {
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
});
