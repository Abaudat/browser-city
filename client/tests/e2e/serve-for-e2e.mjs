// Playwright's `webServer.command`. Starts a disposable local SpacetimeDB
// instance and publishes the module (see spacetime-harness.mjs), then
// execs Vite with VITE_ env vars pointing at that instance -- in that
// order, and in the same process, because Playwright starts `webServer`
// before it runs anything else, so a separate `globalSetup` step's env
// vars never reach this command's child process.
import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_ROOT, startSpacetime, stopSpacetime } from "./spacetime-harness.mjs";

const handle = await startSpacetime();

const viteBin = path.join(REPO_ROOT, "client", "node_modules", ".bin", "vite");
// A single command string, not an args array, so `shell: true` (needed on
// Windows to run the .bin/vite shim at all) does not trip Node's
// unescaped-args deprecation warning.
const vite = spawn(`"${viteBin}" --port 5173 --strictPort`, {
  cwd: path.join(REPO_ROOT, "client"),
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    VITE_SPACETIME_URI: handle.serverUrl.replace(/^http/, "ws"),
    VITE_SPACETIME_DB: handle.dbName,
  },
});

let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  stopSpacetime(handle);
  vite.kill();
}

// Playwright terminates this process when the test run ends; on POSIX that
// is SIGTERM, which Node delivers reliably. Windows has no true SIGTERM,
// so a forceful local-only kill can skip this -- CI (ubuntu-latest) is
// unaffected.
process.on("SIGTERM", () => {
  teardown();
  process.exit(0);
});
process.on("SIGINT", () => {
  teardown();
  process.exit(0);
});
process.on("exit", teardown);
vite.on("exit", (code) => {
  teardown();
  process.exit(code ?? 0);
});
