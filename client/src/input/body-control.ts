// Story 4.8: whether the player's body is this page's to drive. One gate,
// read by everything the player acts through (movement and intents); looking
// and changing settings are not driving and never read it. A reason is a
// name; the body is driveable while no reason is active. Today there is one
// reason: the connection is down after having been up -- steps the city
// never receives have no author in the city. Pure: no DOM, no `net/`.

export interface BodyControl {
  /** Whether the body answers the player right now. */
  isOpen(): boolean;
  /** Raises or clears one named reason the body is not the player's to drive. */
  setReason(reason: string, active: boolean): void;
}

export function createBodyControl(): BodyControl {
  const reasons = new Set<string>();
  return {
    isOpen: () => reasons.size === 0,
    setReason: (reason, active) => {
      if (active) reasons.add(reason);
      else reasons.delete(reason);
    },
  };
}

export const CONNECTION_DOWN = "connection-down";

/** Feeds the gate the connection's status: closed from a drop until the next
 * `connected`, and never on a page that has not yet connected (its boot
 * path must keep working). */
export function connectionReason(control: BodyControl): (status: string) => void {
  let everConnected = false;
  return (status) => {
    if (status === "connected") everConnected = true;
    control.setReason(CONNECTION_DOWN, everConnected && status === "disconnected");
  };
}
