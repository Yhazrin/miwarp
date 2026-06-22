//! v1.0.9 Runtime Diagnostics module.
//!
//! This module is the source of truth for what the diagnostics
//! center captures and how it redacts. The `Observer` trait
//! is what recovery and the runtime hub call into.

pub mod export;
pub mod observer;
pub mod ring_buffer;

pub use export::{
    build_manifest, default_export_path, estimate_export_size, serialize_events_bounded,
    validate_export_path, write_export, DiagnosticExportError, DiagnosticExportManifest,
    DiagnosticExportOutput, ExportTimeRange, MAX_EXPORT_BYTES,
};
pub use observer::{make_event, record_event, DiagnosticObserver, DiagnosticObserverImpl};
pub use ring_buffer::{
    default_rules, DiagnosticCategory, DiagnosticEvent, DiagnosticRingBuffer, DiagnosticSeverity,
    RedactionRule, Redactor, DEFAULT_RING_CAP,
};
