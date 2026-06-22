#[path = "support/runtime_e2e/mod.rs"]
mod runtime_e2e;

use runtime_e2e::harness;

/// Opt-in real runtime smoke/E2E harness.
///
/// Disabled by default. Enable with:
/// `MIWARP_RUNTIME_REAL_E2E=1 cargo test --test runtime_real_e2e -- --nocapture`
#[test]
fn runtime_real_e2e_harness() {
    let report = harness::run();
    harness::print_report(&report);
    harness::assert_report(&report);
}

/// Default CI path: exits immediately without touching real CLIs.
#[test]
fn runtime_real_e2e_disabled_by_default() {
    let report = harness::run();
    if !harness::enabled() {
        assert!(!report.enabled);
        assert!(report.cases.is_empty());
    }
}
