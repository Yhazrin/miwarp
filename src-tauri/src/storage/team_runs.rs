use crate::models::{TeamMemberRun, TeamMemberStatus, TeamRun, TeamRunStatus};
use crate::storage::{data_dir, ensure_dir};
use std::fs;
use std::path::PathBuf;

fn team_runs_dir() -> PathBuf {
    data_dir().join("team-runs")
}

fn team_run_file(id: &str) -> PathBuf {
    team_runs_dir().join(format!("{}.json", id))
}

pub fn create_team_run(team_run: &TeamRun) -> Result<(), String> {
    let dir = team_runs_dir();
    ensure_dir(&dir).map_err(|e| e.to_string())?;
    let path = team_run_file(&team_run.id);
    let json = serde_json::to_string_pretty(team_run).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write team run {}: {}", team_run.id, e))
}

pub fn get_team_run(id: &str) -> Option<TeamRun> {
    let path = team_run_file(id);
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn save_team_run(team_run: &TeamRun) -> Result<(), String> {
    let dir = team_runs_dir();
    ensure_dir(&dir).map_err(|e| e.to_string())?;
    let path = team_run_file(&team_run.id);
    let json = serde_json::to_string_pretty(team_run).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("save team run {}: {}", team_run.id, e))
}

pub fn list_team_runs() -> Vec<TeamRun> {
    let dir = team_runs_dir();
    if !dir.exists() {
        return Vec::new();
    }
    let mut runs: Vec<TeamRun> = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return runs,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(run) = serde_json::from_str::<TeamRun>(&data) {
                runs.push(run);
            }
        }
    }
    runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    runs
}

pub fn update_member_status(
    team_run_id: &str,
    member_id: &str,
    status: TeamMemberStatus,
    run_id: Option<String>,
    summary: Option<String>,
    error: Option<String>,
) -> Result<TeamRun, String> {
    let mut run =
        get_team_run(team_run_id).ok_or_else(|| format!("TeamRun {} not found", team_run_id))?;
    if let Some(member) = run
        .member_runs
        .iter_mut()
        .find(|m| m.member_id == member_id)
    {
        member.status = status;
        if let Some(rid) = run_id {
            member.run_id = Some(rid);
        }
        if let Some(s) = summary {
            member.summary = Some(s);
        }
        if let Some(e) = error {
            member.error = Some(e);
        }
    }
    run.updated_at = crate::models::now_iso();
    save_team_run(&run)?;
    Ok(run)
}

pub fn update_team_run_status(
    id: &str,
    status: TeamRunStatus,
    summary: Option<String>,
    error: Option<String>,
) -> Result<TeamRun, String> {
    let mut run = get_team_run(id).ok_or_else(|| format!("TeamRun {} not found", id))?;
    run.status = status;
    if let Some(s) = summary {
        run.summary = Some(s);
    }
    if let Some(e) = error {
        run.error = Some(e);
    }
    run.updated_at = crate::models::now_iso();
    save_team_run(&run)?;
    Ok(run)
}
