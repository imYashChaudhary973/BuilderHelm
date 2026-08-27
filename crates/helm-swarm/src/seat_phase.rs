/// Seat lifecycle. Stored as the same strings as TypeScript; transitions are
/// explicit here so a concurrent pump cannot invent a silent skip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatPhase {
    Queued,
    Booting,
    Working,
    Idle,
    Exited,
    Failed,
}

impl SeatPhase {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "queued" => Self::Queued,
            "booting" => Self::Booting,
            "working" => Self::Working,
            "idle" => Self::Idle,
            "exited" => Self::Exited,
            "failed" => Self::Failed,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Booting => "booting",
            Self::Working => "working",
            Self::Idle => "idle",
            Self::Exited => "exited",
            Self::Failed => "failed",
        }
    }

    pub fn can_enter(self, next: Self) -> bool {
        use SeatPhase::*;
        matches!(
            (self, next),
            (Queued, Booting)
                | (Queued, Idle)
                | (Queued, Working)
                | (Queued, Exited)
                | (Booting, Idle)
                | (Booting, Working)
                | (Booting, Exited)
                | (Booting, Failed)
                | (Idle, Working)
                | (Idle, Exited)
                | (Working, Idle)
                | (Working, Exited)
                | (Working, Failed)
                | (Failed, Exited)
                | (Failed, Idle)
        ) || self == next
    }

    pub fn enter(self, next: Self) -> Result<Self, String> {
        if self.can_enter(next) {
            Ok(next)
        } else {
            Err(format!(
                "illegal seat transition {} -> {}",
                self.as_str(),
                next.as_str()
            ))
        }
    }
}
