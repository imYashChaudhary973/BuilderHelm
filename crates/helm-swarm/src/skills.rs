pub struct SwarmSkill {
    pub id: &'static str,
    pub title: &'static str,
    pub directive: &'static str,
}

pub const SWARM_SKILLS: &[SwarmSkill] = &[
    SwarmSkill {
        id: "commits",
        title: "Incremental Commits",
        directive: "Commit in small atomic steps after each working change.",
    },
    SwarmSkill {
        id: "refactor",
        title: "Refactor Only",
        directive: "Refactor structure only. Do not change behavior.",
    },
    SwarmSkill {
        id: "monorepo",
        title: "Monorepo Aware",
        directive: "Stay inside the touched package. Do not break workspace boundaries.",
    },
    SwarmSkill {
        id: "tdd",
        title: "Test-Driven",
        directive: "Write a failing test first, then the smallest code that passes.",
    },
    SwarmSkill {
        id: "review",
        title: "Code Review",
        directive: "Review every change before considering the job done.",
    },
    SwarmSkill {
        id: "docs",
        title: "Documentation",
        directive: "Document public APIs and update existing docs you touch.",
    },
    SwarmSkill {
        id: "security",
        title: "Security Audit",
        directive: "Watch for injection, secret leaks, and unsafe defaults.",
    },
    SwarmSkill {
        id: "dry",
        title: "DRY Principle",
        directive: "Remove duplication instead of copying logic.",
    },
    SwarmSkill {
        id: "a11y",
        title: "Accessibility",
        directive: "Keep UI keyboardable, labeled, and contrast-safe (WCAG 2.1 AA).",
    },
    SwarmSkill {
        id: "types",
        title: "Type Strict",
        directive: "Keep types strict. Do not add implicit any or unsafe casts.",
    },
    SwarmSkill {
        id: "lint",
        title: "Lint Clean",
        directive: "Leave lint and format clean in files you touch.",
    },
    SwarmSkill {
        id: "ci",
        title: "Keep CI Green",
        directive: "Do not leave the tree failing typecheck or tests you can run.",
    },
    SwarmSkill {
        id: "migrations",
        title: "Migration Safe",
        directive: "Schema changes must be additive and reversible.",
    },
    SwarmSkill {
        id: "changelog",
        title: "Changelog",
        directive: "Record user-facing changes in the project changelog style.",
    },
    SwarmSkill {
        id: "errors",
        title: "Error Handling",
        directive: "Fail closed on errors. Surface a clear reason. Do not swallow.",
    },
    SwarmSkill {
        id: "perf",
        title: "Performance",
        directive: "Avoid extra allocations and work on hot paths.",
    },
    SwarmSkill {
        id: "privacy",
        title: "Privacy First",
        directive: "Never log secrets, tokens, or personal data.",
    },
    SwarmSkill {
        id: "logging",
        title: "Observability",
        directive: "Log useful state changes. Do not add noisy debug spam.",
    },
];
