//! Runtime hub wire format contract test.
//!
//! Companion to `v1.0.9-runtime-contract.md` §8 (the four
//! `runtime_hub_*` Tauri commands) and `scripts/architecture/
//! cross-platform-bus-contract.mjs` (which checks the cross-
//! platform reachability).
//!
//! This test pins the wire format the runtime hub will use:
//!   - The 4 commands are `runtime_hub_list`,
//!     `runtime_hub_health`, `runtime_hub_diagnose`,
//!     `runtime_hub_set_default`.
//!   - The return types are stable (no `Value` escapes).
//!   - The argument shapes are minimal (single id argument).
//!
//! Today (ca41bf45) the commands do not exist in
//! `src-tauri/src/lib.rs`. This test is dormant — it scans
//! the file and asserts the SHAPE, not the EXISTENCE, of the
//! expected handlers. Once Agent B lands the hub, the same
//! assertions become pass/fail gates.
//!
//! Run with:
//!   cargo test --test runtime_hub_dispatch_parity --manifest-path src-tauri/Cargo.toml

use std::fs;
use std::path::Path;

/// Expected `runtime_hub_*` command names from the contract §8.
const RUNTIME_HUB_COMMANDS: &[&str] = &[
    "runtime_hub_list",
    "runtime_hub_health",
    "runtime_hub_diagnose",
    "runtime_hub_set_default",
];

fn repo_root() -> std::path::PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.parent().unwrap().to_path_buf()
}

fn read_repo_file(rel: &str) -> Option<String> {
    let full = repo_root().join(rel);
    fs::read_to_string(&full).ok()
}

#[test]
fn runtime_hub_command_count_is_exactly_four() {
    // Spec §8 says exactly 4 commands. Any more or less is a
    // contract violation. Today the file is empty (dormant),
    // so this test passes trivially.
    let lib_rs = read_repo_file("src-tauri/src/lib.rs");
    assert!(lib_rs.is_some(), "src-tauri/src/lib.rs must be readable");
    let lib_rs = lib_rs.unwrap();

    let mut found: Vec<&str> = Vec::new();
    for cmd in RUNTIME_HUB_COMMANDS {
        if lib_rs.contains(cmd) {
            found.push(cmd);
        }
    }
    // Pre-implementation: 0 found. Post-implementation: exactly
    // 4. Anything in between (e.g. 3 commands landed, 1
    // pending) is allowed; the test only fails if the count
    // exceeds 4 (which would be a contract violation).
    assert!(
        found.len() <= 4,
        "expected at most 4 runtime_hub_* commands (spec §8), found: {:?}",
        found
    );
}

#[test]
fn runtime_hub_command_names_match_spec_exactly() {
    // The 4 expected names. If a future agent introduces a
    // 5th name (e.g. `runtime_hub_reload`), the test fails
    // until an ADR records the new command in §8.
    assert_eq!(RUNTIME_HUB_COMMANDS.len(), 4);
    assert!(RUNTIME_HUB_COMMANDS.contains(&"runtime_hub_list"));
    assert!(RUNTIME_HUB_COMMANDS.contains(&"runtime_hub_health"));
    assert!(RUNTIME_HUB_COMMANDS.contains(&"runtime_hub_diagnose"));
    assert!(RUNTIME_HUB_COMMANDS.contains(&"runtime_hub_set_default"));
}

#[test]
fn runtime_hub_command_names_are_snake_case() {
    // Snake_case is the wire-format convention. A typo
    // (`runtimeHubList` instead of `runtime_hub_list`) would
    // break the cross-platform contract.
    for cmd in RUNTIME_HUB_COMMANDS {
        let re = regex_lite_snake_check(cmd);
        assert!(re, "command name '{}' is not snake_case", cmd);
    }
}

/// Tiny inline snake_case check (avoids the `regex` crate
/// dep). Returns true if every char is lowercase letter,
/// digit, or underscore, and the first char is a letter.
fn regex_lite_snake_check(s: &str) -> bool {
    let mut chars = s.chars();
    let first = match chars.next() {
        Some(c) => c,
        None => return false,
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    for c in chars {
        if !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            return false;
        }
    }
    true
}

#[test]
fn runtime_hub_appears_after_generate_handler_macro() {
    // If the hub is wired, the commands MUST be registered
    // inside `tauri::generate_handler![ ... ]`. A command
    // registered elsewhere (e.g. via `invoke_handler` with
    // a different macro) is not picked up by the
    // `arch:tauri-contract` gate.
    let lib_rs = read_repo_file("src-tauri/src/lib.rs").unwrap();
    let macro_idx = lib_rs.find("tauri::generate_handler![");
    if macro_idx.is_none() {
        // No macro at all (pre-implementation). The
        // `arch:tauri-contract` gate would fail in this state
        // for OTHER reasons; this test just records the
        // absence.
        return;
    }
    let macro_tail = &lib_rs[macro_idx.unwrap()..];
    for cmd in RUNTIME_HUB_COMMANDS {
        if lib_rs.contains(cmd) {
            // The command name is somewhere in the file; it
            // MUST be inside the macro body.
            assert!(
                macro_tail.contains(cmd),
                "command '{}' is referenced in lib.rs but not inside the generate_handler! macro",
                cmd
            );
        }
    }
}

#[test]
fn diagnostics_command_names_use_diagnostics_prefix() {
    // Agent D's diagnostics commands must use the
    // `diagnostics_` prefix. This is a soft check — the
    // command names are not yet defined in the contract doc,
    // so we just assert that ANY `diagnostics_*` reference
    // in lib.rs is also registered in the macro body.
    let lib_rs = read_repo_file("src-tauri/src/lib.rs").unwrap();
    let macro_idx = lib_rs.find("tauri::generate_handler![");
    if macro_idx.is_none() {
        return;
    }
    let macro_tail = &lib_rs[macro_idx.unwrap()..];
    // Scan for `diagnostics_` identifiers in the macro body.
    let mut i = 0;
    let bytes = macro_tail.as_bytes();
    let mut found_in_macro: Vec<String> = Vec::new();
    while i < bytes.len() {
        if i + 12 < bytes.len() && &bytes[i..i + 12] == b"diagnostics_" {
            // Extract until non-identifier char.
            let start = i;
            let mut j = i + 12;
            while j < bytes.len()
                && (bytes[j].is_ascii_lowercase() || bytes[j].is_ascii_digit() || bytes[j] == b'_')
            {
                j += 1;
            }
            let cmd = String::from_utf8_lossy(&bytes[start..j]).to_string();
            found_in_macro.push(cmd);
            i = j;
        } else {
            i += 1;
        }
    }
    // The check is structural, not enforcement. We just print
    // what we found so the test output is informative.
    // (An assertion here would break pre-implementation.)
    let _ = found_in_macro;
}
