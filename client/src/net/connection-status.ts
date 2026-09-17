// Type-only, so `src/ui/**` can import this one module without reaching
// into the rest of `net/` -- the same idiom `world/**`'s Biome override
// already allow-lists for `../net/bindings/types` (Tim's direction,
// story 1.11 cycle 2). A plain string union, never an SDK type.

/** `"reconnecting"` is deliberately not a member yet: reconnection is
 * story 4.16's work; the union is built so that story adds the member
 * without reshaping either side.
 *
 * `"updating"` (story 2.8, FR147): the boot gate gave up rendering this
 * session -- a guarded reload already happened once for this exact
 * server version and the mismatch is still there. Distinct from
 * `"disconnected"`: the socket itself may be perfectly healthy. */
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "updating";
