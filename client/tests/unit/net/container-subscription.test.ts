// Story 6.10: one open container's subscription, against a fake SDK
// connection. The rules proven here: rows are reported only for the one
// container (and only of the `object` kind), only once the subscription has
// applied; a release asked for while pending is done on apply; and nothing
// is reported after a release.

import { describe, expect, it } from "vitest";
import type { DbConnection } from "../../../src/net/bindings";
import {
  CONTAINER_KIND_OBJECT,
  containerQueries,
  createContainerWiring,
  sdkContainerBackend,
} from "../../../src/net/container-subscription";
import type { HeldRow } from "../../../src/world/container-view";

interface Held {
  instanceId: bigint;
  containerKind: number;
  containerId: bigint;
  slotX: number;
  slotY: number;
  orientation: number;
}
interface Instance {
  instanceId: bigint;
  defId: number;
}

function fakeConnection() {
  const held = new Map<bigint, Held>();
  const instances = new Map<bigint, Instance>();
  const insertCbs = new Set<(ctx: unknown, row: Held) => void>();
  const updateCbs = new Set<(ctx: unknown, old: Held, row: Held) => void>();
  const deleteCbs = new Set<(ctx: unknown, row: Held) => void>();
  const instanceInsertCbs = new Set<(ctx: unknown, row: Instance) => void>();
  let onApplied: () => void = () => {};
  let onError: (ctx: { event: unknown }) => void = () => {};
  let unsubscribed = 0;
  let subscribed = 0;
  const conn = {
    db: {
      itemHeld: {
        iter: () => held.values(),
        onInsert: (cb: (ctx: unknown, row: Held) => void) => insertCbs.add(cb),
        removeOnInsert: (cb: (ctx: unknown, row: Held) => void) => insertCbs.delete(cb),
        onUpdate: (cb: (ctx: unknown, old: Held, row: Held) => void) => updateCbs.add(cb),
        removeOnUpdate: (cb: (ctx: unknown, old: Held, row: Held) => void) => updateCbs.delete(cb),
        onDelete: (cb: (ctx: unknown, row: Held) => void) => deleteCbs.add(cb),
        removeOnDelete: (cb: (ctx: unknown, row: Held) => void) => deleteCbs.delete(cb),
        instanceId: { find: (id: bigint) => held.get(id) ?? null },
      },
      itemInstance: {
        onInsert: (cb: (ctx: unknown, row: Instance) => void) => instanceInsertCbs.add(cb),
        removeOnInsert: (cb: (ctx: unknown, row: Instance) => void) => instanceInsertCbs.delete(cb),
        instanceId: { find: (id: bigint) => instances.get(id) ?? null },
      },
    },
    subscriptionBuilder: () => {
      const builder = {
        onApplied: (cb: () => void) => {
          onApplied = cb;
          return builder;
        },
        onError: (cb: (ctx: { event: unknown }) => void) => {
          onError = cb;
          return builder;
        },
        subscribe: () => {
          subscribed++;
          return {
            unsubscribeThen: (cb: () => void) => {
              unsubscribed++;
              cb();
            },
          };
        },
      };
      return builder;
    },
  };
  return {
    conn: conn as unknown as DbConnection,
    addInstance: (i: Instance) => {
      instances.set(i.instanceId, i);
    },
    insertInstance: (i: Instance) => {
      instances.set(i.instanceId, i);
      for (const cb of instanceInsertCbs) cb(undefined, i);
    },
    insertHeld: (h: Held) => {
      held.set(h.instanceId, h);
      for (const cb of insertCbs) cb(undefined, h);
    },
    updateHeld: (h: Held) => {
      const old = held.get(h.instanceId);
      held.set(h.instanceId, h);
      for (const cb of updateCbs) cb(undefined, old as Held, h);
    },
    deleteHeld: (id: bigint) => {
      const h = held.get(id);
      held.delete(id);
      if (h) for (const cb of deleteCbs) cb(undefined, h);
    },
    apply: () => onApplied(),
    fail: (event: unknown) => onError({ event }),
    counts: () => ({ subscribed, unsubscribed }),
    listeners: () => insertCbs.size + updateCbs.size + deleteCbs.size + instanceInsertCbs.size,
  };
}

const held = (id: bigint, container: bigint, slotX = 0, kind = CONTAINER_KIND_OBJECT): Held => ({
  instanceId: id,
  containerKind: kind,
  containerId: container,
  slotX,
  slotY: 0,
  orientation: 0,
});

function open(fake: ReturnType<typeof fakeConnection>, id: bigint) {
  const reports: { rows: readonly HeldRow[] }[] = [];
  const errors: string[] = [];
  const handle = sdkContainerBackend(fake.conn).open(id, {
    onRows: (rows) => reports.push({ rows }),
    onError: (m) => errors.push(m),
  });
  return { reports, errors, handle };
}

describe("sdkContainerBackend", () => {
  it("issues exactly two typed queries for the container", () => {
    expect(containerQueries(5n)).toHaveLength(2);
  });

  it("reports nothing before the subscription applies, then the container's rows", () => {
    const fake = fakeConnection();
    fake.addInstance({ instanceId: 1n, defId: 9 });
    fake.insertHeld(held(1n, 5n, 2));
    const { reports } = open(fake, 5n);
    expect(reports).toEqual([]);
    fake.apply();
    expect(reports).toHaveLength(1);
    expect(reports[0].rows).toEqual([
      { instanceId: 1n, defId: 9, slotX: 2, slotY: 0, orientation: 0 },
    ]);
  });

  it("filters other containers and other container kinds out", () => {
    const fake = fakeConnection();
    for (const i of [1n, 2n, 3n]) fake.addInstance({ instanceId: i, defId: 9 });
    fake.insertHeld(held(1n, 5n));
    fake.insertHeld(held(2n, 6n));
    fake.insertHeld(held(3n, 5n, 0, 7));
    const { reports } = open(fake, 5n);
    fake.apply();
    expect(reports[0].rows.map((r) => r.instanceId)).toEqual([1n]);
    fake.insertHeld(held(4n, 6n));
    expect(reports).toHaveLength(1);
  });

  it("follows another player's insert, update and delete while open", () => {
    const fake = fakeConnection();
    fake.addInstance({ instanceId: 1n, defId: 9 });
    const { reports } = open(fake, 5n);
    fake.apply();
    fake.insertHeld(held(1n, 5n, 1));
    fake.updateHeld(held(1n, 5n, 3));
    fake.deleteHeld(1n);
    const last = reports[reports.length - 1];
    expect(reports).toHaveLength(4);
    expect(last.rows).toEqual([]);
  });

  it("a row whose instance has not arrived draws nothing, and the full set is reported when it does", () => {
    const fake = fakeConnection();
    const { reports } = open(fake, 5n);
    fake.apply();
    fake.insertHeld(held(1n, 5n));
    expect(reports[reports.length - 1].rows).toEqual([]);
    // The instance row arrives through the semijoin after the held row.
    fake.insertInstance({ instanceId: 1n, defId: 12 });
    expect(reports[reports.length - 1].rows).toEqual([
      { instanceId: 1n, defId: 12, slotX: 0, slotY: 0, orientation: 0 },
    ]);
  });

  it("a release after apply unsubscribes once and stops every report", () => {
    const fake = fakeConnection();
    fake.addInstance({ instanceId: 1n, defId: 9 });
    const { reports, handle } = open(fake, 5n);
    fake.apply();
    handle.release();
    handle.release();
    expect(fake.counts()).toEqual({ subscribed: 1, unsubscribed: 1 });
    expect(fake.listeners()).toBe(0);
    const before = reports.length;
    fake.insertHeld(held(1n, 5n));
    expect(reports).toHaveLength(before);
  });

  it("a release while pending waits for the apply, then unsubscribes without reporting", () => {
    const fake = fakeConnection();
    const { reports, handle } = open(fake, 5n);
    handle.release();
    expect(fake.counts().unsubscribed).toBe(0);
    fake.apply();
    expect(fake.counts().unsubscribed).toBe(1);
    expect(reports).toEqual([]);
  });

  it("an error ends the subscription, drops its listeners and tells the listener", () => {
    const fake = fakeConnection();
    const { errors } = open(fake, 5n);
    const spy = console.error;
    console.error = () => {};
    try {
      fake.fail("boom");
    } finally {
      console.error = spy;
    }
    expect(errors).toEqual(["boom"]);
    expect(fake.listeners()).toBe(0);
  });

  it("a release after an error does not unsubscribe the ended handle", () => {
    const fake = fakeConnection();
    const { handle } = open(fake, 5n);
    const spy = console.error;
    console.error = () => {};
    try {
      fake.fail("boom");
    } finally {
      console.error = spy;
    }
    handle.release();
    expect(fake.counts().unsubscribed).toBe(0);
  });
});

describe("createContainerWiring", () => {
  function wiring() {
    const streamed = new Set<bigint>();
    const opened: bigint[] = [];
    const released: bigint[] = [];
    const w = createContainerWiring({
      isStreamed: (id) => streamed.has(id),
      open: (id) => {
        opened.push(id);
        return { release: () => released.push(id) };
      },
    });
    return { w, streamed, opened, released };
  }
  const noop = () => {};

  it("a non-streamed object never opens the backend and stays present", () => {
    const { w, opened } = wiring();
    const handle = w.rows(7n, noop, noop);
    expect(opened).toEqual([]);
    expect(w.present(7n)).toBe(true);
    handle.release();
    expect(opened).toEqual([]);
  });

  it("a streamed object subscribes once, is present while its row is cached and absent once it leaves", () => {
    const { w, streamed, opened } = wiring();
    streamed.add(7n);
    w.rows(7n, noop, noop);
    expect(opened).toEqual([7n]);
    expect(w.present(7n)).toBe(true);
    streamed.delete(7n);
    expect(w.present(7n)).toBe(false);
  });

  it("releasing a view releases its subscription and un-tracks the container", () => {
    const { w, streamed, released } = wiring();
    streamed.add(7n);
    const handle = w.rows(7n, noop, noop);
    handle.release();
    expect(released).toEqual([7n]);
    streamed.delete(7n);
    expect(w.present(7n)).toBe(true);
  });

  it("a reconnect closes a subscribed view: its row is not cached again until the new region applies", () => {
    const { w, streamed } = wiring();
    streamed.add(7n);
    w.rows(7n, noop, noop);
    // The old connection's rows are gone and the new one's not yet applied.
    streamed.clear();
    expect(w.present(7n)).toBe(false);
  });

  it("a click before the region has delivered the row opens an empty view that stays empty until reopened", () => {
    const { w, streamed, opened } = wiring();
    const first = w.rows(7n, noop, noop);
    streamed.add(7n);
    expect(opened).toEqual([]);
    expect(w.present(7n)).toBe(true);
    first.release();
    w.rows(7n, noop, noop);
    expect(opened).toEqual([7n]);
  });
});
