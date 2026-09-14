// FR148's intent, and deliberately nothing else.
//
// An intent says *which object instance the player acted on*. It does not
// say what the action was, because the input layer does not know and must
// never learn: the procedure interaction model is unresolved until Epic 8
// (AC3), and the whole point of this shape is that Epic 8 can iterate on
// what a click means without touching a line of `input/`.
//
// So: no `kind`, no `action`, no verb, no payload, no target sub-part. If
// a later change wants to add one of those here to make some consumer
// easier to write, that consumer is the thing that should change. The
// only way to widen this record is a story that first explains why the
// *input* layer has to know what it is causing.
//
// `objectId` is a `bigint` end to end -- it is a `u64` primary key, and
// narrowing it through `Number` would silently alias two instances at the
// top of the range.

export interface Intent {
  readonly objectId: bigint;
  readonly defId: number;
}

/** Where an intent goes. One injected function, never an event-emitter
 * library and never a global bus: the emitter has exactly one consumer,
 * chosen by whoever wired the scene, and swapping that consumer is the
 * entire surface Epic 8 needs. */
export type IntentSink = (intent: Intent) => void;

/** Called instead of the sink when the player clicks an object that
 * declares an interaction but is out of reach (AC2). Carries the object
 * so the render side can show *that* object was ignored; it is transient
 * and object-bound, never a DOM notice and never persisted. */
export type IgnoredSink = (objectId: bigint) => void;
