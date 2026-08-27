use helm_db::ZeroDatabase;
use helm_protocol::{
    SwarmLaunchMode, SwarmMessageRecord, SwarmPresetId, SwarmRole, SwarmRunRecord, SwarmSeatRecord,
    SwarmTaskRecord,
};
use serde_json::{json, Value};

fn map_run(row: &helm_db::DbRow) -> SwarmRunRecord {
    serde_json::from_value(Value::Object(row.clone())).expect("swarm run")
}

pub struct SwarmRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> SwarmRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn create_run(&self, run: &SwarmRunRecord, seats: &[SwarmSeatRecord]) {
        self.database.transaction(|| {
            self.database.run(
                "INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
                   skills_json, board_session_id, status, started_at, ended_at, budget_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(run.id),
                    json!(run.name),
                    json!(run.folder_path),
                    json!(run.mission),
                    json!(run.launch_mode),
                    json!(run.preset_id),
                    json!(json!({ "ids": run.skill_ids, "directives": run.skill_directives })),
                    json!(run.board_session_id),
                    json!(run.status),
                    json!(run.started_at),
                    json!(run.ended_at),
                    json!(run.budget_ms),
                ],
            );
            for seat in seats {
                self.insert_seat(seat);
            }
        });
    }

    fn skills_from_json(raw: &Value) -> (Vec<String>, serde_json::Map<String, Value>) {
        if let Some(obj) = raw.as_object() {
            let ids = obj
                .get("ids")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let directives = obj
                .get("directives")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            return (ids, directives);
        }
        (Vec::new(), serde_json::Map::new())
    }

    fn to_run(&self, row: helm_db::DbRow) -> SwarmRunRecord {
        let skills_raw = row.get("skills_json").cloned().unwrap_or(json!("[]"));
        let parsed = if let Some(text) = skills_raw.as_str() {
            serde_json::from_str(text).unwrap_or(json!({}))
        } else {
            skills_raw
        };
        let (ids, directives) = Self::skills_from_json(&parsed);
        let run = json!({
            "id": row.get("id"),
            "name": row.get("name"),
            "folderPath": row.get("folder_path").or_else(|| row.get("folderPath")),
            "mission": row.get("mission"),
            "launchMode": row.get("launch_mode").or_else(|| row.get("launchMode")),
            "presetId": row.get("preset_id").or_else(|| row.get("presetId")),
            "skillIds": ids,
            "skillDirectives": directives,
            "boardSessionId": row.get("board_session_id").or_else(|| row.get("boardSessionId")),
            "status": row.get("status"),
            "startedAt": row.get("started_at").or_else(|| row.get("startedAt")),
            "endedAt": row.get("ended_at").or_else(|| row.get("endedAt")),
            "budgetMs": row.get("budget_ms").or_else(|| row.get("budgetMs")),
        });
        serde_json::from_value(run).unwrap_or_else(|_| map_run(&row))
    }

    pub fn get_run(&self, id: &str) -> Option<SwarmRunRecord> {
        self.database
            .query_one("SELECT * FROM swarm_runs WHERE id = ?", &[json!(id)])
            .map(|row| self.to_run(row))
    }

    pub fn list_runs(&self, limit: i64) -> Vec<SwarmRunRecord> {
        self.database
            .query_all(
                "SELECT * FROM swarm_runs ORDER BY started_at DESC LIMIT ?",
                &[json!(limit)],
            )
            .into_iter()
            .map(|row| self.to_run(row))
            .collect()
    }

    pub fn update_run(&self, id: &str, status: &str, ended_at: Option<&str>) {
        self.database.run(
            "UPDATE swarm_runs SET status = ?, ended_at = ? WHERE id = ?",
            &[json!(status), json!(ended_at), json!(id)],
        );
    }

    #[allow(dead_code)]
    pub fn set_board_session(&self, id: &str, board_session_id: &str) {
        self.database.run(
            "UPDATE swarm_runs SET board_session_id = ? WHERE id = ?",
            &[json!(board_session_id), json!(id)],
        );
    }

    fn insert_seat(&self, seat: &SwarmSeatRecord) {
        self.database.run(
            "INSERT INTO swarm_seats (id, run_id, role, agent_id, mode, pane_id,
               worktree_path, branch, status, tokens_used, cost_usd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                json!(seat.id),
                json!(seat.run_id),
                json!(seat.role),
                json!(seat.agent_id),
                json!(seat.mode),
                json!(seat.pane_id),
                json!(seat.worktree_path),
                json!(seat.branch),
                json!(seat.status),
                json!(seat.tokens_used),
                json!(seat.cost_usd),
            ],
        );
    }

    pub fn add_seat(&self, seat: &SwarmSeatRecord) {
        self.insert_seat(seat);
    }

    pub fn update_seat(&self, seat: &SwarmSeatRecord) {
        self.database.run(
            "UPDATE swarm_seats SET pane_id = ?, worktree_path = ?, branch = ?,
               status = ?, tokens_used = ?, cost_usd = ?
             WHERE id = ?",
            &[
                json!(seat.pane_id),
                json!(seat.worktree_path),
                json!(seat.branch),
                json!(seat.status),
                json!(seat.tokens_used),
                json!(seat.cost_usd),
                json!(seat.id),
            ],
        );
    }

    fn to_seat(&self, row: helm_db::DbRow) -> SwarmSeatRecord {
        serde_json::from_value(json!({
            "id": row.get("id"),
            "runId": row.get("run_id").or_else(|| row.get("runId")),
            "role": row.get("role"),
            "agentId": row.get("agent_id").or_else(|| row.get("agentId")),
            "mode": row.get("mode"),
            "paneId": row.get("pane_id").or_else(|| row.get("paneId")),
            "worktreePath": row.get("worktree_path").or_else(|| row.get("worktreePath")),
            "branch": row.get("branch"),
            "status": row.get("status"),
            "tokensUsed": row.get("tokens_used").or_else(|| row.get("tokensUsed")),
            "costUsd": row.get("cost_usd").or_else(|| row.get("costUsd")),
        }))
        .expect("seat")
    }

    pub fn get_seat(&self, id: &str) -> Option<SwarmSeatRecord> {
        self.database
            .query_one("SELECT * FROM swarm_seats WHERE id = ?", &[json!(id)])
            .map(|row| self.to_seat(row))
    }

    pub fn list_seats(&self, run_id: &str) -> Vec<SwarmSeatRecord> {
        self.database
            .query_all(
                "SELECT * FROM swarm_seats WHERE run_id = ?",
                &[json!(run_id)],
            )
            .into_iter()
            .map(|row| self.to_seat(row))
            .collect()
    }

    fn to_task(&self, row: helm_db::DbRow) -> SwarmTaskRecord {
        let files = row
            .get("files_json")
            .or_else(|| row.get("filesJson"))
            .cloned()
            .unwrap_or(json!("[]"));
        let files = if let Some(text) = files.as_str() {
            serde_json::from_str(text).unwrap_or(json!([]))
        } else {
            files
        };
        let depends = row
            .get("depends_on_json")
            .or_else(|| row.get("dependsOnJson"))
            .cloned()
            .unwrap_or(json!("[]"));
        let depends = if let Some(text) = depends.as_str() {
            serde_json::from_str(text).unwrap_or(json!([]))
        } else {
            depends
        };
        serde_json::from_value(json!({
            "id": row.get("id"),
            "runId": row.get("run_id").or_else(|| row.get("runId")),
            "seatId": row.get("seat_id").or_else(|| row.get("seatId")),
            "title": row.get("title"),
            "detail": row.get("detail"),
            "files": files,
            "status": row.get("status"),
            "dependsOn": depends,
            "attempts": row.get("attempts"),
            "landedCommit": row.get("landed_commit").or_else(|| row.get("landedCommit")),
            "createdAt": row.get("created_at").or_else(|| row.get("createdAt")),
            "updatedAt": row.get("updated_at").or_else(|| row.get("updatedAt")),
        }))
        .expect("task")
    }

    pub fn insert_task(&self, task: &SwarmTaskRecord) {
        self.database.run(
            "INSERT INTO swarm_tasks (id, run_id, seat_id, title, detail, files_json,
               status, depends_on_json, attempts, landed_commit, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                json!(task.id),
                json!(task.run_id),
                json!(task.seat_id),
                json!(task.title),
                json!(task.detail),
                json!(task.files),
                json!(task.status),
                json!(task.depends_on),
                json!(task.attempts),
                json!(task.landed_commit),
                json!(task.created_at),
                json!(task.updated_at),
            ],
        );
    }

    pub fn update_task(&self, task: &SwarmTaskRecord) {
        self.database.run(
            "UPDATE swarm_tasks SET seat_id = ?, status = ?, attempts = ?,
               landed_commit = ?, updated_at = ?
             WHERE id = ?",
            &[
                json!(task.seat_id),
                json!(task.status),
                json!(task.attempts),
                json!(task.landed_commit),
                json!(task.updated_at),
                json!(task.id),
            ],
        );
    }

    pub fn list_tasks(&self, run_id: &str) -> Vec<SwarmTaskRecord> {
        self.database
            .query_all(
                "SELECT * FROM swarm_tasks WHERE run_id = ? ORDER BY created_at ASC",
                &[json!(run_id)],
            )
            .into_iter()
            .map(|row| self.to_task(row))
            .collect()
    }

    pub fn append_message(&self, message: &SwarmMessageRecord) {
        self.database.run(
            "INSERT INTO swarm_messages (id, run_id, seat_id, kind, body, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            &[
                json!(message.id),
                json!(message.run_id),
                json!(message.seat_id),
                json!(message.kind),
                json!(message.body),
                json!(message.created_at),
            ],
        );
    }

    pub fn list_messages(&self, run_id: &str, limit: i64) -> Vec<SwarmMessageRecord> {
        let mut rows: Vec<_> = self
            .database
            .query_all(
                "SELECT * FROM swarm_messages WHERE run_id = ?
                 ORDER BY created_at DESC LIMIT ?",
                &[json!(run_id), json!(limit)],
            )
            .into_iter()
            .map(|row| {
                serde_json::from_value(json!({
                    "id": row.get("id"),
                    "runId": row.get("run_id").or_else(|| row.get("runId")),
                    "seatId": row.get("seat_id").or_else(|| row.get("seatId")),
                    "kind": row.get("kind"),
                    "body": row.get("body"),
                    "createdAt": row.get("created_at").or_else(|| row.get("createdAt")),
                }))
                .expect("message")
            })
            .collect();
        rows.reverse();
        rows
    }
}

#[allow(dead_code)]
fn _types(_: SwarmLaunchMode, _: SwarmPresetId, _: SwarmRole) {}
