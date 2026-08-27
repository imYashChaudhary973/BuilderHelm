mod agent_usage;
mod cli_structured;
mod pnpm_verifier;
mod seat_phase;
mod skills;
mod swarm_planning;
mod swarm_prompt;
mod swarm_repository;
mod swarm_reviewer;
mod swarm_service;

pub use agent_usage::{parse_agent_usage, parse_cli_failure, AgentUsage};
pub use cli_structured::{
    call_structured_agent, structured_cli_args, CliSwarmPlanner, CliSwarmReviewer,
    StructuredCallOptions,
};
pub use pnpm_verifier::{workspace_targets_for_files, PnpmTaskVerifier, PnpmVerifierOptions};
pub use seat_phase::SeatPhase;
pub use swarm_planning::{
    build_plan_prompt, build_repo_snapshot, first_successful_plan, normalize_swarm_plan,
    pin_foundation, plan_budget, single_task_plan, PlannedTask, RepoSnapshot, SwarmPlanRequest,
    SwarmPlanner,
};
pub use swarm_prompt::{
    build_seat_prompt, SeatPromptInput, SeatPromptSkill, SeatPromptTask, SWARM_PROMPT_TASK_MARKER,
    SWARM_TASK_DONE,
};
pub use swarm_reviewer::{
    build_review_prompt, SwarmReviewRequest, SwarmReviewVerdict, SwarmReviewer,
};
pub use swarm_service::{
    SwarmCreateInput, SwarmExecuteInput, SwarmRunnerOutcome, SwarmSeatAssignment, SwarmSeatRunner,
    SwarmService, SwarmServiceOptions, SwarmState, SwarmTaskSpec, SwarmTaskVerifier,
    SwarmVerifyInput, SwarmVerifyResult,
};
