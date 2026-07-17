// Submodules
pub mod types;
pub mod export;
pub mod helpers;
pub mod import;
pub mod index;

// Re-exports for backward compatibility
pub use types::ExportReport;
pub use types::ImportReport;
pub use types::ImportDetail;
pub use types::ImportProgressEvent;
pub use export::export_claude_code_history_archive;

// Tests
#[cfg(test)]
mod tests;
