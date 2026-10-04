// Story 4.8: when the position sender runs -- exactly while the connection
// is `connected` and the caller has a character and the scene a position. It
// stops on leaving `connected` (a call on a dead connection would be queued
// by the SDK without bound) and starts afresh on the next `connected`, so its
// first send is the scene's position at that moment.

import type { PositionSender } from "./position-sender";

export interface SenderLifecycle {
  setConnected(connected: boolean): void;
  /** The caller has a character, and the scene a position and the dials. */
  setReady(ready: boolean): void;
}

export function createSenderLifecycle(start: () => PositionSender): SenderLifecycle {
  let connected = false;
  let ready = false;
  let sender: PositionSender | undefined;
  const sync = (): void => {
    const wanted = connected && ready;
    if (wanted && !sender) sender = start();
    else if (!wanted && sender) {
      sender.stop();
      sender = undefined;
    }
  };
  return {
    setConnected: (value) => {
      connected = value;
      sync();
    },
    setReady: (value) => {
      ready = value;
      sync();
    },
  };
}
