// Story 1.14 (D4): the subscription-decode-only harness. Deliberately
// standalone -- it never imports anything from `client/src/` (the real
// app's boot path is measured separately, against the real production
// build) and its own generated bindings live next to it, never under
// `client/src/net/bindings` (Tim's direction). Never linked from
// `index.html`; built by its own `vite.decode.config.ts`, into its own
// `dist-boot-budget-decode/` directory that `npm run build` never
// produces and `client-build`'s dist-leak check never has to know about.
//
// `?uri=...&db=...` name a disposable SpacetimeDB instance and database
// publishing `server/spikes/boot_budget` -- `run-boot-budget-spike.sh`'s
// own job, never a literal here. Measures exactly one thing: wall time
// from `subscribe()` to that subscription's own `onApplied`, plus the row
// count actually received, so a short count never gets misread as a fast
// decode.
import { DbConnection } from "./bindings";

declare global {
  interface Window {
    __bootDecode?: {
      subscribeStartMs?: number;
      appliedAtMs?: number;
      rowCount?: number;
      error?: string;
    };
  }
}

const params = new URLSearchParams(window.location.search);
const uri = params.get("uri");
const dbName = params.get("db");

window.__bootDecode = {};

if (!uri || !dbName) {
  window.__bootDecode.error = "decode-harness: 'uri' and 'db' query params are required";
} else {
  DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(dbName)
    .onConnect((connection) => {
      const subscribeStartMs = performance.now();
      const bucket = window.__bootDecode;
      if (bucket) bucket.subscribeStartMs = subscribeStartMs;
      connection
        .subscriptionBuilder()
        .onApplied(() => {
          const appliedBucket = window.__bootDecode;
          if (!appliedBucket) return;
          appliedBucket.appliedAtMs = performance.now();
          appliedBucket.rowCount = Number(connection.db.placedObject.count());
        })
        .subscribe("SELECT * FROM placed_object");
    })
    .onConnectError((_ctx, error) => {
      const bucket = window.__bootDecode;
      if (bucket) bucket.error = String(error);
    })
    .build();
}
