// The L3 worker entry: a thin shell that binds the solver to the worker's
// message port and its clock. It is the only file here that reads a clock;
// every rule lives in `solver.ts`.

import type { FromWorker, ToWorker } from "./protocol";
import { L3Solver } from "./solver";

interface WorkerScope {
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  onmessage: ((event: { data: ToWorker }) => void) | null;
}

const scope = self as unknown as WorkerScope;
const solver = new L3Solver({
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  now: () => performance.now(),
});
scope.onmessage = (event) => solver.handle(event.data);
