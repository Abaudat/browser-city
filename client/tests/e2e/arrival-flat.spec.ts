// Story 7.1 (FR145): a first-ever arrival on a database whose district was
// just generated: this spec publishes a second database on the shared
// instance, generates the city's district in it as owner, and serves the
// client against that database from its own Vite server, so no other spec's
// character holds a flat there first.
//
// The real name-prompt first boot runs: the scene mounts at the district's
// arrival cell (`my_start`), `create_character` writes the tenancy and the
// first `player_position` inside the flat's `building_area`, and the scene
// is moved to that row. Then a few real steps prove the position sender is
// alive. Positions and rows are asserted, never pixels.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { parseDefs } from "../../src/defs/parse";
import type {} from "../../src/net/e2e-hooks";
import { expect, test } from "./fixtures";
import {
  callReducer,
  findFreePort,
  ownerSql,
  REPO_ROOT,
  readSpacetimeHandle,
} from "./spacetime-harness.mjs";

const DEFS = parseDefs(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../public/defs/defs.json", import.meta.url)), "utf-8"),
  ),
);
const UNITS = DEFS.positionUnitsPerCell;

test.use({ startAt: "flat" });
test.describe.configure({ mode: "serial" });

let vite: ChildProcess | undefined;
let base = "";
let handle: ReturnType<typeof readSpacetimeHandle>;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  const shared = readSpacetimeHandle();
  handle = { ...shared, dbName: `${shared.dbName}-district` };
  const publish = spawnSync(
    "spacetime",
    [
      "publish",
      "--no-config",
      "--server",
      shared.serverUrl,
      "--module-path",
      "server",
      "--yes",
      handle.dbName,
    ],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (publish.status !== 0)
    throw new Error(`publish failed:\n${publish.stdout}\n${publish.stderr}`);
  callReducer(handle, "create_district");

  const port = await findFreePort();
  const viteBin = path.join(REPO_ROOT, "client", "node_modules", ".bin", "vite");
  vite = spawn(`"${viteBin}" --port ${port} --strictPort`, {
    cwd: path.join(REPO_ROOT, "client"),
    stdio: "ignore",
    shell: true,
    env: {
      ...process.env,
      VITE_SPACETIME_URI: shared.serverUrl.replace(/^http/, "ws"),
      VITE_SPACETIME_DB: handle.dbName,
      VITE_OIDC_AUTHORITY: shared.oidcIssuer,
      VITE_OIDC_CLIENT_ID: shared.oidcClientId,
    },
  });
  base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("the district client never came up");
    await new Promise((r) => setTimeout(r, 500));
  }
});

test.afterAll(() => {
  vite?.kill();
});

interface Row {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

function storedRow(): Row | undefined {
  const r = ownerSql(handle, "SELECT x, y, frac_x, frac_y FROM player_position")[0];
  if (!r) return undefined;
  const [x, y, fx, fy] = r.map(Number);
  return { x, y, fx, fy };
}

const cells = (r: Row) => ({ x: r.x + r.fx / UNITS, y: r.y + r.fy / UNITS });

async function playerAt(page: Page, want: { x: number; y: number }): Promise<void> {
  await page.waitForFunction(
    ({ x, y, q }) => {
      const p = window.__bc?.playerPosition;
      return p !== undefined && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q;
    },
    { ...want, q: 1 / UNITS },
    { timeout: 30_000 },
  );
}

test("a first-ever arrival stands in the flat its tenancy names, and its steps are written", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(`${base}/`);
  await expect.poll(() => storedRow() !== undefined, { timeout: 90_000 }).toBe(true);
  const spawn = storedRow() as Row;

  // The row is inside the building area the tenancy names.
  const inside = ownerSql(
    handle,
    `SELECT t.tenancy_id FROM tenancy t JOIN building_area a ON a.building_id = t.building_id JOIN player_position p ON p.character_id = t.tenant_id WHERE p.x >= a.x0 AND p.x < a.x1 AND p.y >= a.y0 AND p.y < a.y1`,
  );
  expect(inside.length).toBeGreaterThanOrEqual(1);

  // The scene was moved to the row, and the sender did not overwrite it.
  await playerAt(page, cells(spawn));
  await page.waitForTimeout(1500);
  expect(storedRow()).toEqual(spawn);

  // A few real steps: the first direction that is free moves the body, and
  // the stored row follows it.
  let moved = false;
  for (const key of ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(500);
    await page.keyboard.up(key);
    const p = await page.evaluate(() => window.__bc?.playerPosition);
    if (p && (Math.abs(p.x - cells(spawn).x) > 0.2 || Math.abs(p.y - cells(spawn).y) > 0.2)) {
      moved = true;
      break;
    }
  }
  expect(moved).toBe(true);
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no position");
  await expect
    .poll(
      () => {
        const r = storedRow();
        if (!r) return false;
        const c = cells(r);
        return Math.abs(c.x - here.x) <= 1 / UNITS && Math.abs(c.y - here.y) <= 1 / UNITS;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
