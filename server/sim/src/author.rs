//! Authorship of a physical change (FR89). Every change to what the world
//! holds names the citizen who performed it and why. Not a stock concept:
//! item instances and cash take the same type. Nothing here mentions a
//! quantity.

/// Why the world changed: exactly two causes, matched exhaustively
/// everywhere so a third is a compile error until added on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cause {
    ProcedureStep,
    Consumption,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorError {
    ZeroCitizen,
}

/// A citizen acting under a cause. Private fields, no `Default`; built only
/// by [`Author::new`], which refuses citizen id 0 (auto-inc ids start at
/// 1). A player's write names the citizen they drive, never an identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Author {
    citizen_id: u64,
    cause: Cause,
}

impl Author {
    pub fn new(citizen_id: u64, cause: Cause) -> Result<Self, AuthorError> {
        if citizen_id == 0 {
            return Err(AuthorError::ZeroCitizen);
        }
        Ok(Self { citizen_id, cause })
    }

    pub fn citizen_id(&self) -> u64 {
        self.citizen_id
    }

    pub fn cause(&self) -> Cause {
        self.cause
    }
}
