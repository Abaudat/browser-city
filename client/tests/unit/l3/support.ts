import type { Walkability } from "../../../src/l3/micro-path";

/** A mutable grid for tests: a set of blocked cells and a revision that
 * moves on every change. Everything else is walkable. */
export class TestGrid implements Walkability {
  readonly blocked = new Set<string>();
  #revision = 0;

  revision(): number {
    return this.#revision;
  }

  walkable(_floor: number, x: number, y: number): boolean {
    return !this.blocked.has(`${x},${y}`);
  }

  block(x: number, y: number): void {
    this.blocked.add(`${x},${y}`);
    this.#revision++;
  }

  unblock(x: number, y: number): void {
    this.blocked.delete(`${x},${y}`);
    this.#revision++;
  }
}

export const CFG = { marginCells: 6, nodeBudget: 4096 };
