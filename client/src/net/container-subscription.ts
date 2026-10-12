// One open container's contents (Story 6.10, FR94): `item_held WHERE
// container_id = <id>` and the instances those rows name (a typed-builder
// semijoin onto `item_instance`, which carries each row's `def_id`),
// subscribed when a view opens and released when it closes. The region
// never streams held rows -- every cupboard in the region would cost
// bandwidth for views that are almost never open.
//
// The handle follows Interest management's rule: `unsubscribe()` throws on
// a handle that has not applied, so a release asked for while pending is
// done from `onApplied`. Both queries are one handle, so they apply
// together and end together.
//
// `net/` is the only importer of binding values, and this is the second
// file (after `region-subscription.ts`) allowed to call `.subscribe(`.

import type { HeldRow, RowChange } from "../world/container-view";
import type { DbConnection } from "./bindings";
import { tables } from "./bindings";
import type { ItemHeld, ItemInstance } from "./bindings/types";

/** `container_kind` code of `sim::codes::container_kind::OBJECT`: the id is
 * a `placed_object.object_id`. The only kind there is today; a reader
 * filters on it because ids may repeat across kinds. */
export const CONTAINER_KIND_OBJECT = 0;

/** What an open container reports. */
export interface ContainerListener {
  /** The held set after each change, in full. Fired on the first apply and
   * after every row change while the subscription is live. */
  onRows(rows: readonly HeldRow[], change: RowChange | undefined): void;
  onError(message: string): void;
}

export interface ContainerHandle {
  /** Ends the subscription and stops reporting. Safe at any time, once. */
  release(): void;
}

/** The seam the SDK sits behind, so a fake can replace it. */
export interface ContainerBackend {
  open(containerId: bigint, listener: ContainerListener): ContainerHandle;
}

/** The typed queries one open container issues, each a single equality on
 * `container_id` (the semijoin joins on the instance's primary key). */
export function containerQueries(containerId: bigint) {
  const held = tables.itemHeld.where((r) => r.containerId.eq(containerId));
  return [
    held.build(),
    held.rightSemijoin(tables.itemInstance, (h, i) => h.instanceId.eq(i.instanceId)).build(),
  ];
}

/** Joins an `item_held` row to its instance's `def_id`. */
function toRow(held: ItemHeld, instance: ItemInstance | null | undefined): HeldRow | undefined {
  if (!instance) return undefined;
  return {
    instanceId: held.instanceId,
    defId: instance.defId,
    slotX: held.slotX,
    slotY: held.slotY,
    orientation: held.orientation,
  };
}

/** The SDK backend: one `subscribe` per open container, and the cache's own
 * row callbacks filtered to that container. */
export function sdkContainerBackend(conn: DbConnection): ContainerBackend {
  return {
    open(containerId, listener) {
      let ended = false;
      let applied = false;
      let handle: { unsubscribe(): void } | undefined;

      const mine = (row: ItemHeld): boolean =>
        row.containerId === containerId && row.containerKind === CONTAINER_KIND_OBJECT;
      const current = (): HeldRow[] => {
        const out: HeldRow[] = [];
        for (const held of conn.db.itemHeld.iter()) {
          if (!mine(held)) continue;
          const row = toRow(held, conn.db.itemInstance.instanceId.find(held.instanceId));
          if (row) out.push(row);
        }
        return out;
      };
      const report = (change: RowChange | undefined): void => {
        if (!ended && applied) listener.onRows(current(), change);
      };

      const onHeldInsert = (_ctx: unknown, row: ItemHeld) => {
        if (mine(row)) report({ kind: "insert", row: toRow(row, undefined) ?? placeholder(row) });
      };
      const onHeldUpdate = (_ctx: unknown, _old: ItemHeld, row: ItemHeld) => {
        if (mine(row)) report({ kind: "update", row: toRow(row, undefined) ?? placeholder(row) });
      };
      const onHeldDelete = (_ctx: unknown, row: ItemHeld) => {
        if (mine(row)) report({ kind: "delete", row: placeholder(row) });
      };
      const onInstanceInsert = (_ctx: unknown, instance: ItemInstance) => {
        const held = conn.db.itemHeld.instanceId.find(instance.instanceId);
        if (held && mine(held)) report(undefined);
      };

      conn.db.itemHeld.onInsert(onHeldInsert);
      conn.db.itemHeld.onUpdate(onHeldUpdate);
      conn.db.itemHeld.onDelete(onHeldDelete);
      conn.db.itemInstance.onInsert(onInstanceInsert);

      const stop = (): void => {
        if (ended) return;
        ended = true;
        conn.db.itemHeld.removeOnInsert(onHeldInsert);
        conn.db.itemHeld.removeOnUpdate(onHeldUpdate);
        conn.db.itemHeld.removeOnDelete(onHeldDelete);
        conn.db.itemInstance.removeOnInsert(onInstanceInsert);
      };

      let releaseWhenApplied = false;
      handle = conn
        .subscriptionBuilder()
        .onApplied(() => {
          applied = true;
          if (releaseWhenApplied) {
            handle?.unsubscribe();
            return;
          }
          report(undefined);
        })
        .onError((ctx) => {
          console.error("[net] container subscription failed", ctx.event);
          stop();
          listener.onError(String(ctx.event));
        })
        .subscribe(containerQueries(containerId));

      return {
        release() {
          if (ended) return;
          stop();
          if (applied) handle?.unsubscribe();
          else releaseWhenApplied = true;
        },
      };
    },
  };
}

/** A change's row where the instance (and so the def) is not in the cache
 * yet: `defId` 0 matches no item def, so it draws nothing until the full
 * set is reported once the instance arrives. */
function placeholder(held: ItemHeld): HeldRow {
  return {
    instanceId: held.instanceId,
    defId: 0,
    slotX: held.slotX,
    slotY: held.slotY,
    orientation: held.orientation,
  };
}
