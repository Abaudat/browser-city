// Type-only, so `src/ui/**` can import this one module without reaching
// into the rest of `net/` -- the same idiom `world/**`'s Biome override
// already allow-lists for `../net/bindings/types` (Tim's direction,
// story 1.11 cycle 2). A plain string union, never an SDK type.

/** `"reconnecting"` is deliberately not a member yet: reconnection is
 * story 4.16's work; the union is built so that story adds the member
 * without reshaping either side. */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";
