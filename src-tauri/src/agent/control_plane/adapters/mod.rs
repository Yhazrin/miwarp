pub mod claude;
pub mod codex;
pub mod cursor;
pub mod mimo;
pub mod opencode;

use crate::agent::control_plane::adapter::RuntimeAdapter;
use crate::models::AgentRuntimeKind;
use std::sync::Arc;

pub fn all_adapters() -> Vec<Arc<dyn RuntimeAdapter>> {
    vec![
        Arc::new(claude::ClaudeAdapter::new()),
        Arc::new(codex::CodexAdapter::new()),
        Arc::new(mimo::MimoAdapter::new()),
        Arc::new(opencode::OpenCodeAdapter::new()),
        Arc::new(cursor::CursorAdapter::new()),
    ]
}

pub fn adapter_for_kind(kind: &AgentRuntimeKind) -> Option<Arc<dyn RuntimeAdapter>> {
    all_adapters().into_iter().find(|a| &a.kind() == kind)
}

pub fn adapter_for_id(runtime_id: &str) -> Option<Arc<dyn RuntimeAdapter>> {
    all_adapters()
        .into_iter()
        .find(|a| a.runtime_id() == runtime_id)
}
