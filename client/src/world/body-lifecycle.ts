// The body lifecycle (FR58): which ids hold a body, and the order things
// happen in -- acquire the look, only then build the body (posed once at the
// spawn instant), and on despawn destroy it and release the look, whatever
// state its acquire was in. No Pixi: the caller injects what a look and a
// body are, so the whole lifecycle is a unit test.

import {
  type BodyCandidate,
  type BodyPlan,
  type BodyZone,
  createBodyPlan,
  planBodies,
} from "./body-zone";

export interface BodyHooks<Frames, Body> {
  /** Takes one slot of the look for `id`; may reject (the cache is bounded). */
  acquire(id: string): Promise<Frames>;
  /** Gives that slot back. Called exactly once per successful acquire. */
  release(id: string): void;
  /** Builds the body from resolved frames, already posed at city time `t`. */
  create(id: string, frames: Frames, t: number): Body;
  destroy(id: string, body: Body): void;
}

export class BodyLifecycle<Frames, Body> {
  readonly #hooks: BodyHooks<Frames, Body>;
  readonly #onError: (id: string, error: unknown) => void;
  /** Ids that hold a body or are waiting for its frames. */
  readonly #live = new Set<string>();
  readonly #bodies = new Map<string, Body>();
  /** Bumped on every spawn and despawn; an acquire that lands under an old
   * token has been superseded and only releases. */
  readonly #tokens = new Map<string, number>();
  readonly #plan: BodyPlan = createBodyPlan();

  constructor(
    hooks: BodyHooks<Frames, Body>,
    onError: (id: string, error: unknown) => void = () => {},
  ) {
    this.#hooks = hooks;
    this.#onError = onError;
  }

  /** The bodies that exist (drawn, not pending). */
  get bodies(): ReadonlyMap<string, Body> {
    return this.#bodies;
  }

  /** Ids with a body or a pending acquire. */
  get live(): ReadonlySet<string> {
    return this.#live;
  }

  /** Despawns first, then spawns, for the first `count` candidates at city
   * time `t`. Returns the spawns' promises (never rejecting). */
  apply(
    t: number,
    candidates: readonly BodyCandidate[],
    count: number,
    zone: BodyZone,
  ): Promise<void>[] {
    const plan = planBodies(this.#live, candidates, zone, this.#plan, count);
    for (const id of plan.despawn) this.#despawn(id);
    if (plan.spawn.length === 0) return [];
    return plan.spawn.map((id) => this.#spawn(id, t));
  }

  #bump(id: string): number {
    const token = (this.#tokens.get(id) ?? 0) + 1;
    this.#tokens.set(id, token);
    return token;
  }

  async #spawn(id: string, t: number): Promise<void> {
    const token = this.#bump(id);
    this.#live.add(id);
    let frames: Frames;
    try {
      frames = await this.#hooks.acquire(id);
    } catch (error) {
      // Nothing was acquired; the id may try again while it stays in the zone.
      if (this.#tokens.get(id) === token) this.#live.delete(id);
      this.#onError(id, error);
      return;
    }
    if (this.#tokens.get(id) !== token) {
      this.#hooks.release(id);
      return;
    }
    this.#bodies.set(id, this.#hooks.create(id, frames, t));
  }

  #despawn(id: string): void {
    this.#bump(id);
    this.#live.delete(id);
    const body = this.#bodies.get(id);
    if (body === undefined) return; // pending: `#spawn` releases when it lands
    this.#bodies.delete(id);
    this.#hooks.destroy(id, body);
    this.#hooks.release(id);
  }
}
