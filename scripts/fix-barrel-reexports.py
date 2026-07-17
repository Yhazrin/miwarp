#!/usr/bin/env python3
"""Fix barrel re-exports that the first script missed.
Handles: export { X, Y } from "..." and export type { X, Y } from "..."
by removing individual names or entire lines when all names are unused.
"""
import re, os

ROOT = "/root/.openclaw/workspace/miwarp"

# Map of files -> unused names from knip output (only the ones NOT already removed)
REMAINING = {
    # Barrel re-exports
    "src/lib/runtime/index.ts": {
        "CAPABILITY_FLAG_NAMES", "cliSupports", "compareSemVer", "describeCapabilities",
        "parseSemVer", "probeRuntimeAvailability", "probeRuntimeAvailabilityFor",
        "probeRuntimeAvailabilityWithStatus", "versionAtLeast",
        # types
        "CapabilityFlag", "RuntimeCapabilities", "RuntimeProbeOutcome", "SemVer",
        "RuntimeDescriptor", "RuntimeDetection", "RuntimeDetectionMap",
        "RuntimeLaunchSupport", "RuntimeStatus",
    },
    "src/lib/transport/index.ts": {
        "ConnectionState", "ConnectionStateMachine", "TransportError", "IpcTimeoutError",
        "ConnectionTimeoutError", "ConnectionFailedError", "ConnectionClosedError",
        "AuthFailureError", "DisposedError", "NotConnectedError",
        "RequestRegistry", "RequestTimeoutError", "RunSubscriptions", "ChunkAssembler",
        "CircuitBreaker", "CircuitOpenError", "CircuitState", "createTransportCircuitBreaker",
        "_resetTransport", "getInvokeTimeoutMs",
        # types
        "TauriWebviewModule", "TauriDpiModule", "DesktopWindowLike",
        "DesktopWebviewWindowLike", "WsTransportOptions", "ConnectionStateListener",
        "ConnectionStateValue", "RpcError", "PendingEntry",
        "ChunkAssemblerOptions", "TimerApi",
    },
    "src/lib/split/index.ts": {
        "SplitWorkspaceStore", "MAX_PANES", "maxSlotsForLayout", "makePaneId",
        "splitPaneSessionAdapter", "SPLIT_DRAG_MIME", "RUN_DRAG_MIME",
        "beginSplitDrag", "endSplitDrag", "getActiveSplitDragRunId",
        "buildChatUrl", "isSplitModeUrl", "SPLIT_QUERY_PARAM", "RUN_QUERY_PARAM",
        "PANES_QUERY_PARAM", "LAYOUT_QUERY_PARAM", "buildSplitPanes", "parseSplitPanes",
        "readPaneSetFromUrl", "readLayoutFromUrl", "registerSplitWorkspaceLifecycle",
        "unregisterSplitWorkspaceLifecycle", "enterSplitWorkspace", "addSplitPane",
        "activateSplitPane", "closeSplitPane", "exitSplitWorkspace", "toggleSplitWorkspace",
        "reconcileSplitFromUrl", "syncSplitUrlFromStore", "setSplitLayoutMode",
        "isSplitUrlSyncLocked", "withSplitUrlSyncLock",
        # types
        "PaneLoadState", "PaneRuntimeState", "PaneScrollState", "PaneErrorState",
        "PaneSnapshot", "EnterOptions", "AddPaneOptions", "SplitToastKind",
        "SplitToastFn", "XtermLike", "PaneRef", "PaneSetPayload",
        "BuildChatUrlOptions", "SplitWorkspaceLifecycleDeps",
    },
    "src/lib/visual-blocks/index.ts": {
        "VISUAL_LIMITS", "resolveVisualBlockLang", "isVisualBlockLang",
        "VISUAL_SUMMARY_I18N_KEYS", "parseVisualBlock", "isValidVisualBlock",
        "validateSourceText", "validateMermaidSource", "sanitizeMermaidForRender",
        "sanitizeMermaidSvg", "validateJsonValue", "renderCodeBlockHtml",
        "extractCompletedVisualFences", "computeVisualBlockSignature",
        "isEligibleStreamingVisualBlock",
        # types
        "VisualBlockKind", "VisualBlockSpec", "VisualBlockTone", "VisualParseResult",
        "StreamingContentSegment", "StreamingTextSegment", "StreamingVisualSegment",
    },
    "src/lib/stores/reducers/index.ts": {
        "reduceRateLimit", "reduceCompactBoundary", "reduceCommandOutput",
        "reduceFilesPersisted", "reduceSystemStatus", "reduceAuthStatus",
        "reduceToolProgress", "reduceToolUseSummary", "reduceRalphStarted",
        "reduceRalphIteration", "reduceRalphComplete", "reduceUserMessage",
        "reduceUsageUpdate", "reducePermissionDenied",
        # types
        "ReduceCtx", "Reducer", "SessionStoreReducers",
    },
    # Other files with warnings
    "src/lib/layout/app-shell-handlers.svelte.ts": {"handleSessionDragEnd"},
    "src/lib/layout/layout-bootstrap.ts": {"migrateCredentialsIfNeeded"},
    "src/lib/media-resolver.ts": {"resolveArtifact"},
    "src/lib/sensory/config/engine.ts": {"closeAudioContext", "decodeAudioData"},
    "src/lib/services/notification-service.ts": {"ensureNotificationPermission"},
    "src/lib/utils/app-updater.ts": {"discoverAppUpdate"},
    "src/lib/runtime-control-plane/types.ts": {"CapabilityField"},
    "src/lib/types/settings-patch.ts": {"UserSettingsPatch"},
}

def fix_file(filepath, unused_names):
    full = os.path.join(ROOT, filepath)
    if not os.path.exists(full):
        print(f"SKIP: {filepath}"); return
    with open(full) as f:
        lines = f.readlines()
    
    new_lines = []
    removed = set()
    
    for line in lines:
        stripped = line.rstrip('\n')
        
        # Match single-line re-exports: export { X, Y, Z } from "..."
        m = re.match(r'^(\s*)export\s+(type\s+)?\{([^}]+)\}(\s+from\s+.*)?$', stripped)
        if m:
            indent = m.group(1)
            is_type = bool(m.group(2))
            names_str = m.group(3)
            suffix = m.group(4) or ""
            
            # Parse names (handle "X as Y" and "type X")
            parts = [p.strip() for p in names_str.split(',')]
            new_parts = []
            for p in parts:
                # Extract the exported name (before "as")
                name = re.sub(r'\s*as\s+\w+', '', p).strip()
                name = re.sub(r'^type\s+', '', name).strip()
                if name in unused_names:
                    removed.add(name)
                    print(f"  Removed '{name}' from re-export in {filepath}")
                else:
                    new_parts.append(p)
            
            if new_parts:
                new_names = ', '.join(new_parts)
                new_lines.append(f"{indent}export {'type ' if is_type else ''}{{{new_names}}}{suffix}\n")
            else:
                # Entire line removed
                print(f"  Removed entire re-export line in {filepath}")
            continue
        
        new_lines.append(line)
    
    if removed:
        with open(full, 'w') as f:
            f.writelines(new_lines)
        print(f"  Total removed from {filepath}: {len(removed)}")
    
    # Report unfound
    for n in unused_names - removed:
        print(f"  WARN still not found: '{n}' in {filepath}")

def main():
    for fp, names in REMAINING.items():
        if names:
            print(f"\n[{fp}] ({len(names)} remaining)")
            fix_file(fp, names)

if __name__ == "__main__":
    main()
