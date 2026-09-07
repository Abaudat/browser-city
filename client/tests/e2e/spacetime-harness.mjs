// Brings up a real, disposable local SpacetimeDB instance for the e2e
// suite and tears it down again -- no shared state with a developer's own
// `spacetime start`, no manual step, no `sleep`: readiness is a bounded
// poll of the daemon's own health endpoint (Quentin, story 1.1). Plain
// JavaScript, not TypeScript: this module is loaded by
// `serve-for-e2e.mjs`, which Playwright's `webServer.command` runs as a
// bare `node` process outside Playwright's own TS transform.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
// Keyed to REPO_ROOT (not a bare fixed name) so two different worktrees
// running the e2e suite on one machine at the same time never collide and
// clobber each other's handle.
const STATE_FILE = path.join(
  tmpdir(),
  `bc-e2e-spacetime-state-${createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 12)}.json`,
);
// Fixed, not inside the disposable mkdtemp data dir, so a failed run's
// output survives long enough to be read and to ride along with the
// Playwright report artifact upload.
const START_LOG_FILE = path.join(REPO_ROOT, "client", "test-results", "spacetime-start.log");
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
  // A prior crashed run's state file must never look valid to this one:
  // remove it before anything else, so a failure below (which skips the
  // overwrite at the end) can't leave a stale-but-plausible handle behind.
  rmSync(STATE_FILE, { force: true });

  const port = await findFreePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "bc-e2e-spacetime-"));
  const dbName = uniqueDbName();

  mkdirSync(path.dirname(START_LOG_FILE), { recursive: true });
  const logFd = openSync(START_LOG_FILE, "w");
  const child = spawn(
    "spacetime",
    ["start", "--data-dir", dataDir, "--listen-addr", `127.0.0.1:${port}`],
    { cwd: REPO_ROOT, stdio: ["ignore", logFd, logFd] },
  );
  if (child.pid === undefined) {
    throw new Error("failed to spawn `spacetime start`");
  }

  try {
    await waitForHealthy(serverUrl, HEALTH_DEADLINE_MS);
  } catch (error) {
    const log = existsSync(START_LOG_FILE) ? readFileSync(START_LOG_FILE, "utf-8") : "";
    throw new Error(
      `${error.message}\n\n--- spacetime start output (${START_LOG_FILE}) ---\n${log}`,
    );
  }

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
