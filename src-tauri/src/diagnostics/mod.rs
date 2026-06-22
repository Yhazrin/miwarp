//! v1.0.9 Runtime Diagnostics module.
//!
//! This module is the source of truth for what the diagnostics
//! center captures and how it redacts. The `Observer` trait
//! added in a follow-up commit is what recovery and the runtime
//! hub call into. The four `diagnostics_*` Tauri commands
//! (snapshot / summary / export / clear) consume
//! `DiagnosticRingBuffer`.

pub mod ring_buffer;

pub use ring_buffer::{
    default_rules, DiagnosticCategory, DiagnosticEvent, DiagnosticRingBuffer, DiagnosticSeverity,
    RedactionRule, Redactor, DEFAULT_RING_CAP,
};
