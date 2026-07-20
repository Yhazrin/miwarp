mod permission_mode_override_tests {
    //! P0-2 hardening: the IPC boundary delegates to
    //! `agent::adapter::canonicalize_permission_mode`, which is the
    //! single source of truth shared with the frontend, the cursor
    //! adapter, and the argv builder. The tests below exercise the
    //! canonicalization contract (alias → canonical, reject unknown)
    //! and confirm the canonical form is in the documented set.
    use crate::agent::adapter;

    /// Aliases from `agent::adapter::map_permission_mode`'s contract must
    /// canonicalize to a documented CLI mode. These are the values the
    /// frontend, Agent Editor, and session-store all flow through.
    #[test]
    fn canonicalizes_legacy_aliases() {
        assert_eq!(
            adapter::canonicalize_permission_mode("ask").unwrap(),
            "default"
        );
        assert_eq!(
            adapter::canonicalize_permission_mode("auto_read").unwrap(),
            "acceptEdits"
        );
        assert_eq!(
            adapter::canonicalize_permission_mode("auto_all").unwrap(),
            "bypassPermissions"
        );
        assert_eq!(
            adapter::canonicalize_permission_mode("delegate").unwrap(),
            "acceptEdits",
            "CLI v2.1.81+ alias must canonicalize to acceptEdits"
        );
        assert_eq!(
            adapter::canonicalize_permission_mode("dont_ask").unwrap(),
            "dontAsk"
        );
    }

    /// Already-canonical values pass through unchanged.
    #[test]
    fn canonicalizes_passes_through_canonical_values() {
        for canonical in adapter::CANONICAL_PERMISSION_MODES {
            assert_eq!(
                adapter::canonicalize_permission_mode(canonical).unwrap(),
                *canonical,
                "canonical value `{canonical}` must pass through"
            );
        }
    }

    /// Every value the canonical function returns must be in
    /// `CANONICAL_PERMISSION_MODES`. This is the single-source-of-truth
    /// invariant — if a future addition to the alias table produces a
    /// value outside the documented set, this test fires.
    #[test]
    fn canonicalize_never_produces_uncanonical_value() {
        for input in [
            "ask",
            "auto_read",
            "auto_all",
            "auto-accept-all",
            "delegate",
            "dont_ask",
            "default",
            "acceptEdits",
            "bypassPermissions",
            "dontAsk",
            "plan",
        ] {
            let canonical = adapter::canonicalize_permission_mode(input)
                .unwrap_or_else(|e| panic!("{input} should be valid: {e}"));
            assert!(
                adapter::CANONICAL_PERMISSION_MODES.contains(&canonical.as_str()),
                "canonicalize_permission_mode({input}) produced non-canonical value: {canonical}"
            );
        }
    }

    /// Free-form / unknown strings must be rejected. The IPC boundary
    /// must not let the frontend smuggle a value the CLI does not
    /// understand.
    #[test]
    fn rejects_unknown_string() {
        for unknown in [
            "totally-made-up",
            "ACCEPTEDITS", // case-sensitive — must not silently pass
            "PLAN",
            "Default",
            " plan", // whitespace-padded
            "plan ",
            "bypass-permissions", // wrong separator
            "delegated",          // looks like delegate but is not
            "",
        ] {
            assert!(
                adapter::canonicalize_permission_mode(unknown).is_err(),
                "validator must reject `{unknown}`"
            );
        }
    }

    /// P0-2 integration: `start_session_impl` rejects an unknown
    /// permission-mode override with a structured PermissionError
    /// BEFORE acquiring the spawn lock. We exercise that by passing a
    /// clearly invalid override and confirming the canonical validator
    /// rejects it. (We cannot actually spawn a CLI here, so this is
    /// the boundary-test equivalent.)
    #[test]
    fn start_session_impl_canonicalizes_then_validates() {
        for bad in ["ACCEPTEDITS", "bypass-permissions", "delegated", ""] {
            let err = adapter::canonicalize_permission_mode(bad)
                .err()
                .unwrap_or_else(|| panic!("`{bad}` should be rejected"));
            assert!(
                err.contains("Unknown permission mode"),
                "error message must be structured: {err}"
            );
        }
    }
}
