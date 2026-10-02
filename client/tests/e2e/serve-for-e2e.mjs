// Playwright's `webServer.command`. Starts a disposable local SpacetimeDB
// instance and publishes the module (see spacetime-harness.mjs), then
// execs Vite with VITE_ env vars pointing at that instance -- in that
// order, and in the same process, because Playwright starts `webServer`
// before it runs anything else, so a separate `globalSetup` step's env
// vars never reach this command's child process.
import { spawn } from "node:child_process";
import path from "node:path";
import { startLocalOidcIssuer } from "./local-oidc-issuer.mjs";
import {
  callReducer,
  findFreePort,
  REPO_ROOT,
  recordHandleExtra,
  startSpacetime,
  stopSpacetime,
} from "./spacetime-harness.mjs";

const OIDC_CLIENT_ID = "bc-e2e";

const handle = await startSpacetime();

// Story 4.5: a disposable local OIDC issuer, registered with the module the
// way `deploy.yml` registers the real one, and handed to the client build.
const oidc = await startLocalOidcIssuer({ port: await findFreePort(), clientId: OIDC_CLIENT_ID });
callReducer(handle, "accept_oidc_issuer", oidc.issuer, OIDC_CLIENT_ID);
recordHandleExtra(handle, { oidcIssuer: oidc.issuer, oidcClientId: OIDC_CLIENT_ID });

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
    VITE_OIDC_AUTHORITY: oidc.issuer,
    VITE_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
  },
});

let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  stopSpacetime(handle);
  oidc.close();
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
