import Foundation

// MARK: - Bus Event

struct BusEvent: Identifiable {
    let seq: Int
    let runId: String
    let payload: BusEventPayload

    var id: Int { seq }

    init(seq: Int, runId: String, payload: BusEventPayload) {
        self.seq = seq
        self.runId = runId
        self.payload = payload
    }
}

extension BusEvent: Codable {
    enum CodingKeys: String, CodingKey {
        case seq
        case _seq
        case runId = "run_id"
        case payload
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Broadcast format has `seq`, RPC flat format has `_seq`
        if let s = try container.decodeIfPresent(Int.self, forKey: .seq) {
            seq = s
        } else if let s = try container.decodeIfPresent(Int.self, forKey: ._seq) {
            seq = s
        } else {
            seq = 0
        }

        runId = try container.decodeIfPresent(String.self, forKey: .runId) ?? ""

        // Broadcast format has `payload` wrapper; RPC flat format is the payload itself
        if let p = try container.decodeIfPresent(BusEventPayload.self, forKey: .payload) {
            payload = p
        } else {
            // Flat format — decode the whole object as a BusEventPayload
            payload = try BusEventPayload(from: decoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(seq, forKey: .seq)
        try container.encode(runId, forKey: .runId)
        try payload.encode(to: encoder)
    }
}
