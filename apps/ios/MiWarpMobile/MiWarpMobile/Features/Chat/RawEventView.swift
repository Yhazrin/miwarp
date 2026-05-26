import SwiftUI

struct RawEventView: View {
    let events: [BusEvent]
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var theme: MWTheme
    @State private var searchText = ""
    @State private var selectedEvent: BusEvent?

    private var filteredEvents: [BusEvent] {
        if searchText.isEmpty { return events }
        let query = searchText.lowercased()
        return events.filter { event in
            event.payloadTypeName.lowercased().contains(query) ||
                event.runId.lowercased().contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            List(filteredEvents) { event in
                Button {
                    selectedEvent = event
                } label: {
                    eventRow(event)
                }
                .buttonStyle(.plain)
                .listRowBackground(theme.cardBg)
            }
            .searchable(text: $searchText, prompt: String(localized: "rawEvents.filter"))
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
            .navigationTitle(String(format: String(localized: "rawEvents.title"), events.count))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "action.done")) { dismiss() }
                }
            }
            .sheet(item: $selectedEvent) { event in
                eventDetailSheet(event)
            }
        }
    }

    // MARK: - Event Row

    private func eventRow(_ event: BusEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(event.payloadTypeName)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(MWColors.accentPrimary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(MWColors.accentPrimary.opacity(0.12), in: Capsule())

                Spacer()

                Text("#\(event.seq)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
            }

            Text(event.runId.prefix(12) + "...")
                .font(.caption2.monospaced())
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }

    // MARK: - Event Detail Sheet

    private func eventDetailSheet(_ event: BusEvent) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Header
                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.payloadTypeName)
                            .font(.headline)
                            .foregroundStyle(MWColors.accentPrimary)
                        Text("seq: \(event.seq) · run: \(event.runId.prefix(12))...")
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                    }

                    Divider()

                    // JSON payload
                    Text(formattedPayload(event))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding()
            }
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
            .navigationTitle(String(localized: "rawEvents.eventDetail"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "action.done")) { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        #if os(iOS)
                        UIPasteboard.general.string = formattedPayload(event)
                        #endif
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                }
            }
        }
    }

    private func formattedPayload(_ event: BusEvent) -> String {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(event.payload)
            return String(data: data, encoding: .utf8) ?? "Encoding error"
        } catch {
            return "JSON error: \(error.localizedDescription)"
        }
    }
}

// MARK: - Payload Type Name Extension

extension BusEvent {
    var payloadTypeName: String {
        switch payload {
        case .sessionInit: return "session_init"
        case .messageDelta: return "message_delta"
        case .messageComplete: return "message_complete"
        case .toolStart: return "tool_start"
        case .toolEnd: return "tool_end"
        case .userMessage: return "user_message"
        case .runState: return "run_state"
        case .usageUpdate: return "usage_update"
        case .thinkingDelta: return "thinking_delta"
        case .toolInputDelta: return "tool_input_delta"
        case .permissionPrompt: return "permission_prompt"
        case .permissionDenied: return "permission_denied"
        case .compactBoundary: return "compact_boundary"
        case .systemStatus: return "system_status"
        case .hookStarted: return "hook_started"
        case .hookProgress: return "hook_progress"
        case .hookResponse: return "hook_response"
        case .hookCallback: return "hook_callback"
        case .taskNotification: return "task_notification"
        case .toolProgress: return "tool_progress"
        case .toolUseSummary: return "tool_use_summary"
        case .filesPersisted: return "files_persisted"
        case .controlCancelled: return "control_cancelled"
        case .commandOutput: return "command_output"
        case .elicitationPrompt: return "elicitation_prompt"
        case .rateLimitEvent: return "rate_limit_event"
        case .authStatus: return "auth_status"
        case .ralphStarted: return "ralph_started"
        case .ralphIteration: return "ralph_iteration"
        case .ralphComplete: return "ralph_complete"
        case .raw: return "raw"
        }
    }
}
