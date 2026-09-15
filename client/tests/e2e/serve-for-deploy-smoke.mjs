// PR-time rehearsal of client/tests/e2e/deploy-smoke.spec.ts (the deploy
// story, Quentin's direction): builds the real *production*, Pages-base
// client (`--base=/browser-city/`) against a disposable local
// SpacetimeDB, serves it with `vite preview` under that same base, and
// runs the `deploy-smoke` Playwright project against it -- so a broken
// smoke spec, or a base that only works at `/`, is caught before merge,
// never only after a real deploy. `ci.yml`'s `e2e` job is the only
// caller; `.github/workflows/deploy.yml`'s own `smoke` job runs the
// identical spec directly against the live URL, no build, no webServer.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { findFreePort, REPO_ROOT, startSpacetime, stopSpacetime } from "./spacetime-harness.mjs";

const BASE_PATH = "/browser-city/";
const CLIENT_DIR = path.join(REPO_ROOT, "client");
const HEALTH_DEADLINE_MS = 20_000;

function run(command, env) {
  // A single command string, not an args array, so `shell: true` (needed
  // on Windows to run the .bin/vite shim at all) does not trip Node's
  // unescaped-args deprecation warning -- the same idiom serve-for-e2e.mjs
  // uses.
  const result = spawnSync(command, {
    cwd: CLIENT_DIR,
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`'${command}' failed (exit ${result.status})`);
  }
}

async function waitHealthy(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} did not become healthy within ${deadlineMs}ms: ${String(lastError)}`);
}

const handle = await startSpacetime();

let preview;
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  if (preview) preview.kill();
  stopSpacetime(handle);
}
process.on("SIGTERM", () => {
  teardown();
  process.exit(0);
});
process.on("SIGINT", () => {
  teardown();
  process.exit(0);
});
process.on("exit", teardown);

try {
  run("npx vite build --base=/browser-city/ --outDir dist-deploy-smoke", {
    VITE_SPACETIME_URI: handle.serverUrl.replace(/^http/, "ws"),
    VITE_SPACETIME_DB: handle.dbName,
  });

  const previewPort = await findFreePort();
  const previewBin = path.join(CLIENT_DIR, "node_modules", ".bin", "vite");
  preview = spawn(
    `"${previewBin}" preview --base=${BASE_PATH} --outDir dist-deploy-smoke --port ${previewPort} --strictPort`,
    { cwd: CLIENT_DIR, stdio: "inherit", shell: true, env: process.env },
  );

  const previewUrl = `http://127.0.0.1:${previewPort}${BASE_PATH}`;
  await waitHealthy(previewUrl, HEALTH_DEADLINE_MS);
  console.error(`serve-for-deploy-smoke: production-base build served at ${previewUrl}`);

  const playwrightResult = spawnSync("npx playwright test --project=deploy-smoke", {
    cwd: CLIENT_DIR,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      BC_DEPLOY_URL: previewUrl,
      BC_DEPLOY_EXPECT_WS_ORIGIN: handle.serverUrl.replace(/^http/, "ws"),
      BC_DEPLOY_EXPECT_DB: handle.dbName,
    },
  });
  if (playwrightResult.status !== 0) {
    throw new Error("the deploy-smoke Playwright project failed");
  }
} finally {
  teardown();
}
