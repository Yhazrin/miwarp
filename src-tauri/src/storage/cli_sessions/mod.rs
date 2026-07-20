// Submodules
mod discover;
mod import;
mod sync;
mod types;
mod util;

// Re-exports for backward compatibility
pub use discover::discover_sessions;
pub use discover::invalidate_imported_cache;
pub use import::import_session;
pub use sync::session_has_pending_sync;
pub use sync::source_file_mtime_ns;
pub use sync::sync_session;
pub use sync::watermark_indicates_pending_sync;
pub use types::CliSessionSummary;
pub use types::DiscoverResult;
pub use types::ImportResult;
pub use types::SyncResult;
pub use util::encode_cwd;
pub use util::normalize_transcript_line;

// Tests
#[cfg(test)]
mod tests;
