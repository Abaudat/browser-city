// One open container's contents (Story 6.10, FR94): `item_held WHERE
// container_id = <id>` and the instances those rows name (a typed-builder
// semijoin onto `item_instance`, which carries each row's `def_id`),
// subscribed when a view opens and released when it closes. The region
// never streams held rows -- every cupboard in the region would cost
// bandwidth for views that are almost never open.
//
// The handle follows Interest management's rule, as `region-subscription.ts`
// does: `unsubscribe()` throws on a handle that is pending or has ended, so
// a release asked for while pending is done from `onApplied`, and one after
// the handle ended (an error, a dropped connection) does nothing. Both
// queries are one handle, so they apply and end together. Only a container
// whose object the server streamed to this client is ever subscribed.
//
// `net/` is the only importer of binding values, and this is the third file
// allowed to call `.subscribe(`.

import type { HeldRow } from "../world/container-view";
import type { DbConnection } from "./bindings";
import { tables } from "./bindings";
import type { ItemHeld, ItemInstance } from "./bindings/types";

/** `container_kind` code of `sim::codes::container_kind::OBJECT`: the id is
 * a `placed_object.object_id`. The only kind there is today; a reader
 * filters on it because ids may repeat across kinds. */
export const CONTAINER_KIND_OBJECT = 0;

/** What an open container reports. */
export interface ContainerListener {
  /** The held set, in full: on the first apply and after every change. */
  onRows(rows: readonly HeldRow[]): void;
  /** The subscription failed; no rows follow. */
  onError(message: string): void;
}

export interface ContainerHandle {
  /** Ends the subscription and stops reporting. Safe at any time, any
   * number of times. */
  release(): void;
}

/** The seam the SDK sits behind, so a fake can replace it. */
export interface ContainerBackend {
  open(containerId: bigint, listener: ContainerListener): ContainerHandle;
}

/** Whether the server streamed `placed_object` `objectId` to this client:
 * the only containers a view subscribes to. A fixture-only prop is not. */
export function isStreamedObject(conn: DbConnection, objectId: bigint): boolean {
  return conn.db.placedObject.objectId.find(objectId) != null;
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

/** Joins an `item_held` row to its instance's `def_id`; a row whose
 * instance has not arrived yet is left out until it does. */
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
      let stopped = false;
      let applied = false;
      let ended = false;
      let releaseWhenApplied = false;
      let handle: { unsubscribeThen(cb: () => void): void } | undefined;

      const mine = (row: ItemHeld): boolean =>
        row.containerId === containerId && row.containerKind === CONTAINER_KIND_OBJECT;
      const report = (): void => {
        if (stopped || !applied) return;
        const rows: HeldRow[] = [];
        for (const held of conn.db.itemHeld.iter()) {
          if (!mine(held)) continue;
          const row = toRow(held, conn.db.itemInstance.instanceId.find(held.instanceId));
          if (row) rows.push(row);
        }
        listener.onRows(rows);
      };

      const onHeld = (_ctx: unknown, row: ItemHeld) => {
        if (mine(row)) report();
      };
      const onHeldUpdate = (_ctx: unknown, _old: ItemHeld, row: ItemHeld) => {
        if (mine(row)) report();
      };
      const onInstance = (_ctx: unknown, instance: ItemInstance) => {
        const held = conn.db.itemHeld.instanceId.find(instance.instanceId);
        if (held && mine(held)) report();
      };
      conn.db.itemHeld.onInsert(onHeld);
      conn.db.itemHeld.onUpdate(onHeldUpdate);
      conn.db.itemHeld.onDelete(onHeld);
      conn.db.itemInstance.onInsert(onInstance);

      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        conn.db.itemHeld.removeOnInsert(onHeld);
        conn.db.itemHeld.removeOnUpdate(onHeldUpdate);
        conn.db.itemHeld.removeOnDelete(onHeld);
        conn.db.itemInstance.removeOnInsert(onInstance);
      };
      const unsubscribe = (): void => {
        if (ended) return;
        ended = true;
        handle?.unsubscribeThen(() => {});
      };

      handle = conn
        .subscriptionBuilder()
        .onApplied(() => {
          applied = true;
          if (releaseWhenApplied) {
            unsubscribe();
            return;
          }
          report();
        })
        .onError((ctx) => {
          console.error("[net] container subscription failed", ctx.event);
          // An errored handle has ended: nothing is left to unsubscribe.
          ended = true;
          const wasStopped = stopped;
          stop();
          if (!wasStopped) listener.onError(String(ctx.event));
        })
        .subscribe(containerQueries(containerId));

      return {
        release() {
          if (stopped) return;
          stop();
          if (applied) unsubscribe();
          else releaseWhenApplied = true;
        },
      };
    },
  };
}

/** What the scene asks of the network about one container. */
export interface ContainerWiring {
  /** Subscribes to a streamed container's rows; a fixture-only prop gets a
   * no-op handle and an empty view. */
  rows(
    containerId: bigint,
    onRows: (rows: readonly HeldRow[]) => void,
    onError: () => void,
  ): ContainerHandle;
  /** Whether the container's object still exists: always for a fixture-only
   * prop, and for a subscribed one while its streamed row is cached. */
  present(objectId: bigint): boolean;
}

export interface ContainerWiringSeams {
  /** Whether the server streamed `objectId` to the current connection. */
  isStreamed(objectId: bigint): boolean;
  open(containerId: bigint, listener: ContainerListener): ContainerHandle;
}

/** The decisions between a click and a subscription (story 6.10):
 *  - a container is subscribed only if the server streamed its object *at
 *    the moment the view opens*; a prop that is not (the live street's
 *    fixture cupboard, or a click before the region delivers its row) opens
 *    an empty view that stays empty until reopened;
 *  - a subscribed container is present while its row stays cached, so a row
 *    leaving the cache -- its object deleted, or a reconnect before the new
 *    connection's region applies -- closes its view;
 *  - releasing a view un-tracks the container. */
export function createContainerWiring(seams: ContainerWiringSeams): ContainerWiring {
  const subscribed = new Set<bigint>();
  return {
    rows(containerId, onRows, onError) {
      if (!seams.isStreamed(containerId)) return { release: () => {} };
      subscribed.add(containerId);
      const handle = seams.open(containerId, { onRows, onError });
      return {
        release() {
          subscribed.delete(containerId);
          handle.release();
        },
      };
    },
    present: (objectId) => !subscribed.has(objectId) || seams.isStreamed(objectId),
  };
}
