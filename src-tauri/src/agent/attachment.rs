//! Attachment data type shared across the actor, turn engine, and recovery
//! modules. Extracted to a leaf module to break an architecture cycle that
//! would otherwise form between `session_actor` and `runtime_recovery`
//! (both legitimately need this struct, but neither should depend on the
//! other purely for it).

/// Attachment data for multimodal messages (images, documents).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AttachmentData {
    pub content_base64: String,
    pub media_type: String,
    pub filename: String,
}
