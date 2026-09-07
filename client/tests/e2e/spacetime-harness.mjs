// Brings up a real, disposable local SpacetimeDB instance for the e2e
// suite and tears it down again -- no shared state with a developer's own
// `spacetime start`, no manual step, no `sleep`: readiness is a bounded
// poll of the daemon's own health endpoint (Quentin, story 1.1). Plain
// JavaScript, not TypeScript: this module is loaded by
// `serve-for-e2e.mjs`, which Playwright's `webServer.command` runs as a
// bare `node` process outside Playwright's own TS transform.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
const STATE_FILE = path.join(tmpdir(), "bc-e2e-spacetime-state.json");
const HEALTH_DEADLINE_MS = 20_000;
const HEALTH_POLL_INTERVAL_MS = 200;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        srv.close(() => reject(new Error("could not determine a free port")));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealthy(serverUrl, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverUrl}/v1/ping`);
      if (response.ok) return;
      lastError = new Error(`/v1/ping responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(
    `SpacetimeDB did not become healthy at ${serverUrl} within ${deadlineMs}ms: ${String(lastError)}`,
  );
}

/** A database name unique to this run, satisfying SpacetimeDB's `[a-z0-9]+(-[a-z0-9]+)*` rule. */
function uniqueDbName() {
  return `bc-e2e-${Date.now()}-${process.pid}`;
}

export async function startSpacetime() {
  const port = await findFreePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "bc-e2e-spacetime-"));
  const dbName = uniqueDbName();

  const child = spawn(
    "spacetime",
    ["start", "--data-dir", dataDir, "--listen-addr", `127.0.0.1:${port}`],
    { cwd: REPO_ROOT, stdio: "ignore" },
  );
  if (child.pid === undefined) {
    throw new Error("failed to spawn `spacetime start`");
  }

  await waitForHealthy(serverUrl, HEALTH_DEADLINE_MS);

  const publish = spawnSync(
    "spacetime",
    ["publish", "--no-config", "--server", serverUrl, "--module-path", "server", "--yes", dbName],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (publish.status !== 0) {
    throw new Error(`spacetime publish failed:\n${publish.stdout}\n${publish.stderr}`);
  }

  const handle = { pid: child.pid, port, serverUrl, dbName, dataDir };
  writeFileSync(STATE_FILE, JSON.stringify(handle), "utf-8");
  return handle;
}

export function readSpacetimeHandle() {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `${STATE_FILE} does not exist -- serve-for-e2e.mjs did not run or already tore down`,
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
}

export function stopSpacetime(handle) {
  try {
    process.kill(handle.pid);
  } catch {
    // Already gone -- nothing left to do.
  }
  rmSync(handle.dataDir, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}

/** Calls a reducer through the CLI -- a real reducer write, never a direct table poke. */
export function callReducer(handle, reducer, ...args) {
  const result = spawnSync(
    "spacetime",
    ["call", "--no-config", "--server", handle.serverUrl, "--yes", handle.dbName, reducer, ...args],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`spacetime call ${reducer} failed:\n${result.stdout}\n${result.stderr}`);
  }
}
