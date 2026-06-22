import { describe, it, expect, beforeEach } from "vitest";
import type { BusEvent } from "$lib/types";
import {
  ProtocolQuarantineCoordinator,
  PROTOCOL_FULL_RELOAD_THRESHOLD,
  PROTOCOL_RECOVER_THRESHOLD,
  PROTOCOL_TERMINATE_THRESHOLD,
  parseBusEnvelope,
  parseRawBusJson,
} from "./protocol-quarantine";

const RUN = "run-1";

function inspect(
  coordinator: ProtocolQuarantineCoordinator,
  payload: unknown,
  opts: { subscribedRunId?: string; lastSeq?: number } = {},
) {
  return coordinator.inspect({
    runId: RUN,
    subscribedRunId: opts.subscribedRunId ?? RUN,
    payload,
    lastSeq: opts.lastSeq ?? 0,
  });
}

describe("parseRawBusJson / parseBusEnvelope", () => {
  it("rejects malformed JSON without throwing", () => {
    const result = parseRawBusJson("{not-json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("malformed_json");
    }
  });

  it("rejects payload missing type or run_id", () => {
    expect(parseBusEnvelope(null).ok).toBe(false);
    expect(parseBusEnvelope({ type: "message_delta" }).ok).toBe(false);
    expect(parseBusEnvelope({ run_id: RUN }).ok).toBe(false);
  });

  it("accepts minimal valid envelope", () => {
    const result = parseBusEnvelope({ type: "message_delta", run_id: RUN, text: "hi" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.type).toBe("message_delta");
      expect(result.envelope.runId).toBe(RUN);
    }
  });
});

describe("ProtocolQuarantineCoordinator", () => {
  let coordinator: ProtocolQuarantineCoordinator;

  beforeEach(() => {
    coordinator = new ProtocolQuarantineCoordinator();
  });

  it("passes structurally valid events but resets only after apply success", () => {
    for (let i = 0; i < PROTOCOL_RECOVER_THRESHOLD - 1; i++) {
      const bad = inspect(coordinator, { type: "message_delta", run_id: "other-run" });
      expect(bad.action).toBe("drop");
    }
    expect(coordinator.getState(RUN).phase).toBe("degraded");

    const good: BusEvent = { type: "message_delta", run_id: RUN, text: "ok" };
    const pass = inspect(coordinator, good);
    expect(pass.action).toBe("pass");
    expect(coordinator.getState(RUN).phase).toBe("degraded");

    coordinator.recordApplySuccess(RUN);
    expect(coordinator.getState(RUN).phase).toBe("healthy");
    expect(coordinator.getState(RUN).consecutiveInvariantErrors).toBe(0);
  });

  it("drops unknown event types as ignorable without counting toward threshold", () => {
    for (let i = 0; i < PROTOCOL_TERMINATE_THRESHOLD + 5; i++) {
      const result = inspect(coordinator, {
        type: "brand_new_future_event",
        run_id: RUN,
        payload: "secret-user-text",
      });
      expect(result.action).toBe("drop");
      expect(result.category).toBe("ignorable");
    }
    expect(coordinator.getState(RUN).consecutiveInvariantErrors).toBe(0);
    expect(coordinator.getState(RUN).phase).toBe("healthy");
  });

  it("drops wrong run_id as invariant and escalates to recover at threshold", () => {
    let lastAction: string = "";
    for (let i = 1; i <= PROTOCOL_RECOVER_THRESHOLD; i++) {
      const result = inspect(coordinator, {
        type: "message_delta",
        run_id: "wrong-run",
        text: "x",
      });
      lastAction = result.action;
    }
    expect(lastAction).toBe("recover");
    expect(coordinator.getState(RUN).recoverAttempted).toBe(true);
  });

  it("drops duplicate seq as ignorable", () => {
    const result = inspect(
      coordinator,
      { type: "message_delta", run_id: RUN, text: "a", _seq: 5 },
      { lastSeq: 5 },
    );
    expect(result.action).toBe("drop");
    expect(result.category).toBe("ignorable");
    expect(result.evidence?.kind).toBe("duplicate_seq");
  });

  it("treats seq regression as invariant", () => {
    const result = inspect(
      coordinator,
      { type: "message_delta", run_id: RUN, text: "a", _seq: 3 },
      { lastSeq: 10 },
    );
    expect(result.action).toBe("drop");
    expect(result.category).toBe("invariant");
    expect(result.evidence?.kind).toBe("seq_regression");
  });

  it("escalates consecutive invariant errors: recover → full_reload → terminate", () => {
    const actions: string[] = [];
    for (let i = 1; i <= PROTOCOL_TERMINATE_THRESHOLD; i++) {
      const result = inspect(coordinator, { type: "message_delta", run_id: "wrong" });
      actions.push(result.action);
    }
    expect(actions).toContain("recover");
    expect(actions).toContain("full_reload");
    expect(actions[PROTOCOL_FULL_RELOAD_THRESHOLD - 1]).toBe("full_reload");
    expect(actions[actions.length - 1]).toBe("terminate");
    expect(coordinator.getState(RUN).phase).toBe("terminated");
  });

  it("recordApplyFailure counts as invariant", () => {
    for (let i = 0; i < PROTOCOL_RECOVER_THRESHOLD - 1; i++) {
      coordinator.recordApplyFailure(RUN, "message_complete");
    }
    const result = coordinator.recordApplyFailure(RUN, "message_complete");
    expect(result.action).toBe("recover");
  });

  it("recordApplySuccess resets consecutive counter", () => {
    for (let i = 0; i < 3; i++) {
      inspect(coordinator, { type: "message_delta", run_id: "wrong" });
    }
    coordinator.recordApplySuccess(RUN);
    expect(coordinator.getState(RUN).consecutiveInvariantErrors).toBe(0);
    expect(coordinator.getState(RUN).phase).toBe("healthy");
  });

  it("passes backend recovery events and resets on session_recovered ok", () => {
    const recovering = inspect(coordinator, {
      type: "session_recovering",
      run_id: RUN,
      reason: "timeout",
      deadline_ms: 5000,
    });
    expect(recovering.action).toBe("pass");

    for (let i = 0; i < 3; i++) {
      inspect(coordinator, { type: "message_delta", run_id: "wrong" });
    }
    const recovered = inspect(coordinator, { type: "session_recovered", run_id: RUN, ok: true });
    expect(recovered.action).toBe("pass");
    expect(coordinator.getState(RUN).phase).toBe("healthy");
  });

  it("enters terminated on backend protocol_desync", () => {
    const result = inspect(coordinator, {
      type: "protocol_desync",
      run_id: RUN,
      fail_count: 99,
      sample: "sensitive-cli-output-should-not-appear-in-evidence",
    });
    expect(result.action).toBe("terminate");
    expect(coordinator.getState(RUN).phase).toBe("terminated");
    expect(coordinator.getState(RUN).lastError?.detail).not.toContain("sensitive");
  });

  it("recovery after normal events: degraded → healthy", () => {
    for (let i = 0; i < 2; i++) {
      inspect(coordinator, { type: "message_delta", run_id: "wrong" });
    }
    expect(coordinator.getState(RUN).phase).toBe("degraded");

    inspect(coordinator, { type: "message_delta", run_id: RUN, text: "recovered" });
    expect(coordinator.getState(RUN).phase).toBe("degraded");
    coordinator.recordApplySuccess(RUN);
    expect(coordinator.getState(RUN).phase).toBe("healthy");
  });

  it("evidence detail is sanitized (no payload text)", () => {
    const result = inspect(coordinator, {
      type: "totally_unknown",
      run_id: RUN,
      text: "user-secret-message",
    });
    expect(result.evidence?.detail).not.toContain("user-secret");
    expect(result.evidence?.detail).toContain("unknown type");
  });
});
