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
    },
  },
  preview: {
    host: "127.0.0.1",
  },
});
