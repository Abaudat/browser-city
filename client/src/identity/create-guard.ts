// Story 4.5 (FR141): nothing may create a character for an identity whose
// token could not be kept -- the character would be orphaned the moment the
// tab closed. The guard sits on the create path itself, so no caller has to
// remember to check.

export function guardedCreateCharacter(
  isPersisted: () => boolean,
  create: () => Promise<void>,
): () => Promise<void> {
  return () =>
    isPersisted()
      ? create()
      : Promise.reject(new Error("identity is not persisted: refusing to create a character"));
}
