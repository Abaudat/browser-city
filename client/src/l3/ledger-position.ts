// Where a citizen's ledger says it is at city time `t`: the taut straight
// route between tile centres, paced by `legInstants`. Cheap and body-free --
// the body zone is judged on this, so a citizen outside it never costs a
// micro-path, a pose or an appearance.

import { type Leg, legInstants } from "./body";
import type { CitizenState } from "./citizen";

export interface LedgerPoint {
  x: number;
  y: number;
  floor: number;
}

/** A leg's instants, computed once per leg: the zone pass runs every frame. */
const instantsOf = new WeakMap<object, number[]>();

function instantsFor(leg: Leg): number[] {
  let instants = instantsOf.get(leg);
  if (!instants) {
    instants = legInstants(leg);
    instantsOf.set(leg, instants);
  }
  return instants;
}

/** Writes the ledger position of `state` at `t` into `out`. */
export function ledgerPositionAt(state: CitizenState, t: number, out: LedgerPoint): void {
  if (state.kind === "at") {
    out.x = state.node.x + 0.5;
    out.y = state.node.y + 0.5;
    out.floor = state.node.floor;
    return;
  }
  const { waypoints, departAt, arriveAt } = state.leg;
  const last = waypoints.length - 1;
  const first = waypoints[0];
  if (!first) return;
  if (t <= departAt || last === 0) {
    out.x = first.x + 0.5;
    out.y = first.y + 0.5;
    out.floor = first.floor;
    return;
  }
  const end = waypoints[last] as (typeof waypoints)[number];
  if (t >= arriveAt) {
    out.x = end.x + 0.5;
    out.y = end.y + 0.5;
    out.floor = end.floor;
    return;
  }
  const instants = instantsFor(state.leg);
  let s = 0;
  while (s < last - 1 && t >= (instants[s + 1] as number)) s++;
  const a = waypoints[s] as (typeof waypoints)[number];
  const b = waypoints[s + 1] as (typeof waypoints)[number];
  const t0 = instants[s] as number;
  const span = (instants[s + 1] as number) - t0;
  const u = span === 0 ? 1 : (t - t0) / span;
  out.x = a.x + 0.5 + (b.x - a.x) * u;
  out.y = a.y + 0.5 + (b.y - a.y) * u;
  out.floor = u < 1 ? a.floor : b.floor;
}
