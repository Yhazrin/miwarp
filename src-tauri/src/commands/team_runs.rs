use crate::models::{TeamMemberStatus, TeamPreset, TeamPresetMember, TeamRun, TeamRunStatus};
use crate::storage::team_runs;

/// Returns the built-in team presets.
fn builtin_presets() -> Vec<TeamPreset> {
    vec![
        TeamPreset {
            id: "fullstack".to_string(),
            name: "Fullstack Team".to_string(),
            description: "Architecture, frontend, backend, and testing — split across 4 specialists.".to_string(),
            members: vec![
                TeamPresetMember {
                    id: "architect".to_string(),
                    name: "Architect".to_string(),
                    role: "system_architect".to_string(),
                    system_prompt: "You are a software architect. Analyze the task and create a clear technical plan with file structure, data models, and API design. Focus on correctness and simplicity. Output your plan as a structured document.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "frontend".to_string(),
                    name: "Frontend Dev".to_string(),
                    role: "frontend_developer".to_string(),
                    system_prompt: "You are a frontend developer specializing in Svelte 5, TypeScript, and Tailwind CSS. Implement the UI components and pages according to the architect's plan. Use Svelte 5 runes ($state, $derived, $effect, $props). Follow the existing code patterns in the project.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "backend".to_string(),
                    name: "Backend Dev".to_string(),
                    role: "backend_developer".to_string(),
                    system_prompt: "You are a backend developer specializing in Rust and Tauri v2. Implement the backend commands, storage, and data models according to the architect's plan. Follow existing patterns in src-tauri/.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "tester".to_string(),
                    name: "QA Engineer".to_string(),
                    role: "qa_engineer".to_string(),
                    system_prompt: "You are a QA engineer. Review the implementation for bugs, edge cases, and missing error handling. Write or update tests. Check that the feature works end-to-end and report any issues.".to_string(),
                    default_model: None,
                },
            ],
        },
        TeamPreset {
            id: "review".to_string(),
            name: "Review Team".to_string(),
            description: "Security, performance, and maintainability review from 3 angles.".to_string(),
            members: vec![
                TeamPresetMember {
                    id: "security".to_string(),
                    name: "Security Reviewer".to_string(),
                    role: "security_reviewer".to_string(),
                    system_prompt: "You are a security code reviewer. Analyze the code for security vulnerabilities: injection, XSS, CSRF, auth bypass, data exposure, unsafe deserialization, and OWASP top 10. Report findings with severity and suggested fixes.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "performance".to_string(),
                    name: "Performance Reviewer".to_string(),
                    role: "performance_reviewer".to_string(),
                    system_prompt: "You are a performance reviewer. Analyze the code for performance issues: unnecessary re-renders, memory leaks, N+1 queries, missing caching, bundle size concerns, and inefficient algorithms. Report findings with impact assessment.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "maintainability".to_string(),
                    name: "Maintainability Reviewer".to_string(),
                    role: "maintainability_reviewer".to_string(),
                    system_prompt: "You are a code quality reviewer. Analyze the code for maintainability: naming clarity, separation of concerns, dead code, missing abstractions, test coverage gaps, and documentation. Report findings with refactoring suggestions.".to_string(),
                    default_model: None,
                },
            ],
        },
        TeamPreset {
            id: "research".to_string(),
            name: "Research Team".to_string(),
            description: "Research, codebase scan, and solution synthesis from 3 specialists.".to_string(),
            members: vec![
                TeamPresetMember {
                    id: "researcher".to_string(),
                    name: "Researcher".to_string(),
                    role: "researcher".to_string(),
                    system_prompt: "You are a technical researcher. Search the web, documentation, and codebase for relevant information about the task. Gather context, best practices, and existing solutions. Output a structured research summary.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "scanner".to_string(),
                    name: "Code Scanner".to_string(),
                    role: "code_scanner".to_string(),
                    system_prompt: "You are a codebase analyst. Scan the project structure, existing patterns, and related code to understand the current state. Identify relevant files, existing implementations, and integration points. Output a codebase map relevant to the task.".to_string(),
                    default_model: None,
                },
                TeamPresetMember {
                    id: "synthesizer".to_string(),
                    name: "Solution Architect".to_string(),
                    role: "solution_architect".to_string(),
                    system_prompt: "You are a solution architect. Given the research findings and codebase analysis, synthesize a concrete implementation plan. Prioritize simplicity, correctness, and minimal changes. Output actionable steps.".to_string(),
                    default_model: None,
                },
            ],
        },
    ]
}

#[tauri::command]
pub fn list_team_presets() -> Result<Vec<TeamPreset>, String> {
    log::debug!("[team_runs] list_team_presets");
    Ok(builtin_presets())
}

#[tauri::command]
pub fn create_team_run(
    preset_id: String,
    prompt: String,
    cwd: String,
    source_run_id: Option<String>,
    mode: Option<String>,
) -> Result<TeamRun, String> {
    log::debug!(
        "[team_runs] create_team_run: preset={}, cwd={}",
        preset_id,
        cwd
    );

    let presets = builtin_presets();
    let preset = presets
        .iter()
        .find(|p| p.id == preset_id)
        .ok_or_else(|| format!("Unknown preset: {}", preset_id))?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::models::now_iso();

    let member_runs: Vec<crate::models::TeamMemberRun> = preset
        .members
        .iter()
        .map(|m| crate::models::TeamMemberRun {
            id: uuid::Uuid::new_v4().to_string(),
            member_id: m.id.clone(),
            member_name: m.name.clone(),
            role: m.role.clone(),
            task: String::new(), // filled after planning
            status: TeamMemberStatus::Pending,
            run_id: None,
            summary: None,
            error: None,
        })
        .collect();

    let team_run = TeamRun {
        id: id.clone(),
        team_name: preset.name.clone(),
        preset_id: preset_id.clone(),
        cwd,
        source_run_id,
        prompt,
        mode: mode.unwrap_or_else(|| "plan_first".to_string()),
        status: TeamRunStatus::Created,
        member_runs,
        summary: None,
        error: None,
        lead_run_id: None,
        lead_plan: None,
        created_at: now.clone(),
        updated_at: now,
    };

    team_runs::create_team_run(&team_run)?;
    log::debug!("[team_runs] created team run: {}", id);
    Ok(team_run)
}

#[tauri::command]
pub fn list_team_runs() -> Result<Vec<TeamRun>, String> {
    log::debug!("[team_runs] list_team_runs");
    Ok(team_runs::list_team_runs())
}

#[tauri::command]
pub fn get_team_run(id: String) -> Result<TeamRun, String> {
    log::debug!("[team_runs] get_team_run: {}", id);
    team_runs::get_team_run(&id).ok_or_else(|| format!("TeamRun {} not found", id))
}

#[tauri::command]
pub fn cancel_team_run(id: String) -> Result<TeamRun, String> {
    log::debug!("[team_runs] cancel_team_run: {}", id);
    team_runs::update_team_run_status(&id, TeamRunStatus::Cancelled, None, None)
}

#[tauri::command]
pub fn update_team_run_status(
    id: String,
    status: String,
    summary: Option<String>,
    error: Option<String>,
) -> Result<TeamRun, String> {
    log::debug!("[team_runs] update_team_run_status: {} -> {}", id, status);
    let s = match status.as_str() {
        "created" => TeamRunStatus::Created,
        "planning" => TeamRunStatus::Planning,
        "running" => TeamRunStatus::Running,
        "completed" => TeamRunStatus::Completed,
        "failed" => TeamRunStatus::Failed,
        "cancelled" => TeamRunStatus::Cancelled,
        _ => return Err(format!("Invalid status: {}", status)),
    };
    team_runs::update_team_run_status(&id, s, summary, error)
}

#[tauri::command]
pub fn update_team_member_run(
    team_run_id: String,
    member_id: String,
    status: String,
    run_id: Option<String>,
    summary: Option<String>,
    error: Option<String>,
) -> Result<TeamRun, String> {
    log::debug!(
        "[team_runs] update_team_member_run: {} / {} -> {}",
        team_run_id,
        member_id,
        status
    );
    let s = match status.as_str() {
        "pending" => TeamMemberStatus::Pending,
        "running" => TeamMemberStatus::Running,
        "completed" => TeamMemberStatus::Completed,
        "failed" => TeamMemberStatus::Failed,
        _ => return Err(format!("Invalid member status: {}", status)),
    };
    team_runs::update_member_status(&team_run_id, &member_id, s, run_id, summary, error)
}

#[tauri::command]
pub fn set_team_run_lead(
    id: String,
    lead_run_id: String,
    lead_plan: Option<String>,
) -> Result<TeamRun, String> {
    log::debug!("[team_runs] set_team_run_lead: {} -> {}", id, lead_run_id);
    let mut run =
        team_runs::get_team_run(&id).ok_or_else(|| format!("TeamRun {} not found", id))?;
    run.lead_run_id = Some(lead_run_id);
    if let Some(plan) = lead_plan {
        run.lead_plan = Some(plan);
    }
    run.updated_at = crate::models::now_iso();
    team_runs::save_team_run(&run)?;
    Ok(run)
}

#[tauri::command]
pub fn set_team_member_task(
    team_run_id: String,
    member_id: String,
    task: String,
) -> Result<TeamRun, String> {
    log::debug!(
        "[team_runs] set_team_member_task: {} / {}",
        team_run_id,
        member_id
    );
    let mut run = team_runs::get_team_run(&team_run_id)
        .ok_or_else(|| format!("TeamRun {} not found", team_run_id))?;
    if let Some(member) = run
        .member_runs
        .iter_mut()
        .find(|m| m.member_id == member_id)
    {
        member.task = task;
    }
    run.updated_at = crate::models::now_iso();
    team_runs::save_team_run(&run)?;
    Ok(run)
}
