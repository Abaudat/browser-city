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

// The one client mirror of the chunk packing (Node strips the types).

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

// Exported for serve-for-deploy-smoke.mjs's own preview server port (the
// deploy story) -- never a second copy of this logic.
export function findFreePort() {
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

export async function startSpacetime({ timeControl = false } = {}) {
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

  // `timeControl` publishes the dev-only flavour (`jump_clock`/
  // `set_clock_speed`, FR163) through `scripts/dev/publish-dev.sh`, the one
  // build path for it, so a spec can age a character by city days. Only the
  // functional e2e server asks; every other caller (the deploy-smoke
  // rehearsal included) publishes the production module as deployed.
  const publish = timeControl
    ? spawnSync(
        "bash",
        [
          path.join(REPO_ROOT, "scripts", "dev", "publish-dev.sh"),
          dbName,
          "--server",
          serverUrl,
          "--no-config",
        ],
        { cwd: REPO_ROOT, encoding: "utf-8" },
      )
    : spawnSync(
        "spacetime",
        [
          "publish",
          "--no-config",
          "--server",
          serverUrl,
          "--module-path",
          "server",
          "--yes",
          dbName,
        ],
        { cwd: REPO_ROOT, encoding: "utf-8" },
      );
  if (publish.status !== 0) {
    throw new Error(`spacetime publish failed:\n${publish.stdout}\n${publish.stderr}`);
  }

  const handle = { pid: child.pid, port, serverUrl, dbName, dataDir };
  // The functional e2e world is the city -- generated once, by the module's
  // own owner-only reducer, from `city.seed` -- with the fixture block
  // (`fixtures/fixture-block.v1.json`) standing in its north-west corner:
  // restored first, through the module's own restore path, so its ids are
  // its own; the district's rows under it are cleared after generation.
  // The deploy-smoke flavour has neither the block nor the reducer that
  // clears under it, and walks the city as deployed.
  if (timeControl) restoreBlock(handle);
  callReducer(handle, "create_district");
  if (timeControl) {
    clearUnderBlock(handle);
    // The district's ids follow the block's (the restore leaves a gap of
    // its own after them): the pinned dump's first row is the district's
    // first placed row, so its id is the shift a spec reading the dump
    // applies (`district-support.ts`).
    handle.blockPlaced = firstDistrictId(handle, "placed_object", "object_id", E2E_BLOCK.maxId) - 1;
    handle.blockGround =
      firstDistrictId(handle, "ground_area", "area_id", E2E_BLOCK.ground.length) - 1;
  }
  writeFileSync(STATE_FILE, JSON.stringify(handle), "utf-8");
  return handle;
}

/** The fixture block as the harness reads it. */
export const E2E_BLOCK = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "fixtures", "fixture-block.v1.json"), "utf-8"),
);

/** The block's cupboard and what is in it, for the container spec. */
export const E2E_CUPBOARD = E2E_BLOCK.cupboard;

const rowsJson = (rows) => `[${rows.map((r) => `[${r.join(",")}]`).join(",")}]`;

function restoreBlock(handle) {
  const count = (rows) => String(rows.length);
  callReducer(handle, "begin_restore");
  callReducer(handle, "restore_placed_object", rowsJson(E2E_BLOCK.placed), count(E2E_BLOCK.placed));
  callReducer(
    handle,
    "restore_floor_transition",
    rowsJson(E2E_BLOCK.transitions),
    count(E2E_BLOCK.transitions),
  );
  callReducer(handle, "restore_ground_area", rowsJson(E2E_BLOCK.ground), count(E2E_BLOCK.ground));
  // The cupboard holds five known items: instance `i` is the cupboard's
  // `i - 1`th seeded item, held at its slot.
  const items = E2E_CUPBOARD.items;
  const instances = items.map((it, i) => `[${i + 1},${it.defId},[0]]`);
  const held = items.map(
    (it, i) => `[${i + 1},0,${E2E_CUPBOARD.objectId},${it.slotX},${it.slotY},${it.orientation}]`,
  );
  callReducer(
    handle,
    "restore_item_instance",
    `[${instances.join(",")}]`,
    String(instances.length),
  );
  callReducer(handle, "restore_item_held", `[${held.join(",")}]`);
  callReducer(handle, "finish_restore");
}

/** The id the module gave the district's first row of `table`: the first id
 * above the block's own that exists. */
function firstDistrictId(handle, table, column, blockMax) {
  for (let id = blockMax + 1; id <= blockMax + 16; id++) {
    if (ownerSql(handle, `SELECT ${column} FROM ${table} WHERE ${column} = ${id}`).length > 0) {
      return id;
    }
  }
  throw new Error(`the district's first ${table} row was not found above the block's ids`);
}

function clearUnderBlock(handle) {
  const c = E2E_BLOCK.chunks;
  callReducer(
    handle,
    "debug_clear_chunks",
    String(c.cx0),
    String(c.cy0),
    String(c.cx1),
    String(c.cy1),
    "0",
    String(E2E_BLOCK.maxId),
  );
}

/** Adds fields to the persisted handle (story 4.5: the local OIDC issuer's
 * admin URL), for the specs that read it back. */
export function recordHandleExtra(handle, extra) {
  Object.assign(handle, extra);
  writeFileSync(STATE_FILE, JSON.stringify(handle), "utf-8");
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

/** Reads a table as the module owner through `spacetime sql`: rows of
 * trimmed cell strings, header rows dropped. Read-only. */
export function ownerSql(handle, query) {
  const result = spawnSync(
    "spacetime",
    ["sql", "--no-config", "--server", handle.serverUrl, "--yes", handle.dbName, query],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`spacetime sql failed (${query}):\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .slice(2)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("|").map((cell) => cell.trim()));
}
