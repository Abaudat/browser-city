#!/usr/bin/env bash
# scripts/ci/check-l3-boundary.sh's own coverage (story 5.1): plants each
# violation in a throwaway directory and asserts exit 1, plus the imports L3
# really makes, asserting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-l3-boundary.sh"
REAL_L3="$REPO_ROOT/client/src/l3"

plant() { # <content> -- writes it to a fresh fake l3 dir's only *.ts file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/body.ts"
  printf '%s' "$d"
}
plant_net() { # <content> -- a fake net dir
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/connection.ts"
  printf '%s' "$d"
}

d="$(plant 'import type { Defs } from "../defs/types";')"
check "a defs type import" 0 bash "$CHECK" "$d"
d="$(plant 'import { findMicroPath } from "./micro-path";')"
check "a sibling import" 0 bash "$CHECK" "$d"
d="$(plant '// never reads window or Date.now: time is an argument')"
check "a comment naming a banned global is never a false positive" 0 bash "$CHECK" "$d"
d="$(plant 'const windowSize = 3; const documentation = 1; export { windowSize, documentation };')"
check "an identifier containing window or document is never a false positive" 0 bash "$CHECK" "$d"
d="$(plant 'export const t = foo.fetch; export const s = other.self;')"
check "a property named fetch or self is never a false positive" 0 bash "$CHECK" "$d"

while IFS= read -r spec; do
  d="$(plant "$spec")"
  check "banned specifier: $spec" 1 bash "$CHECK" "$d"
done <<'SPECS'
import { DbConnection } from "spacetimedb";
import { callReducer } from "../net/bindings";
import type { Row } from "../net/bindings/types";
import { Sprite } from "pixi.js";
import { STREET_PROPS } from "../test-street/fixture";
import { step } from "../world/movement";
import { step } from "../world/movement.js";
import { stepAndTransition } from "../world/floor-walk";
import { CollisionGrid } from "../world/collision-grid";
import { WorldIndex } from "../world/world-index";
import { keyboard } from "../input/keyboard";
import { ServerClock } from "../time/server-clock";
import { CityClock } from "../time/city-clock";
import { worldPointPx } from "../render/screen-position";
import { load } from "../identity/identity-storage";
import { overlay } from "../debug/overlays";
import "../settings/side-effect";
export * from "../net/connection";
const m = await import("../net/connection");
const m = require("fs");
SPECS

while IFS= read -r code; do
  d="$(plant "$code")"
  check "banned global: $code" 1 bash "$CHECK" "$d"
done <<'GLOBALS'
export const t = performance.now();
export const t = Date.now();
export const d = new Date();
export const r = Math.random();
export const w = window.innerWidth;
export const e = document.body;
export const g = globalThis.window;
export const s = self.postMessage;
export const x = await fetch("/");
export const ws = new WebSocket("ws://x");
export const x = new XMLHttpRequest();
export const n = navigator.userAgent;
export const l = localStorage.getItem("k");
export const l = sessionStorage.getItem("k");
export const u = crypto.randomUUID();
requestAnimationFrame(() => {});
setTimeout(() => {}, 1);
setInterval(() => {}, 1);
GLOBALS

d="$(plant_net 'import { findMicroPath } from "../l3/micro-path";')"
check "net/ importing l3/" 1 bash "$CHECK" "$REAL_L3" "$d"
d="$(plant_net 'const m = await import("../l3/body");')"
check "net/ dynamically importing l3/" 1 bash "$CHECK" "$REAL_L3" "$d"
d="$(plant_net 'import { connect } from "./bindings";')"
check "net/ importing its own modules" 0 bash "$CHECK" "$REAL_L3" "$d"

summary
exit $?
