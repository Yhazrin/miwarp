import Foundation
import Security

// MARK: - Keychain Helper

enum MiWarpKeychain {
    private static let service = "com.miwarp.mobile"

    static func save(token: String, for connectionId: UUID) throws {
        let account = connectionId.uuidString
        guard let data = token.data(using: .utf8) else {
            throw KeychainError.encodingFailed
        }

        // Delete existing item first
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        // Add new item
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status: status)
        }
    }

    static func load(for connectionId: UUID) throws -> String? {
        let account = connectionId.uuidString
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainError.loadFailed(status: status)
        }
        guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.decodingFailed
        }
        return token
    }

    static func delete(for connectionId: UUID) {
        let account = connectionId.uuidString
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func deleteAll() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Errors

    enum KeychainError: LocalizedError {
        case encodingFailed
        case decodingFailed
        case saveFailed(status: OSStatus)
        case loadFailed(status: OSStatus)

        var errorDescription: String? {
            switch self {
            case .encodingFailed:
                return "Failed to encode token data"
            case .decodingFailed:
                return "Failed to decode token data"
            case .saveFailed(let status):
                return "Failed to save to keychain (status: \(status))"
            case .loadFailed(let status):
                return "Failed to load from keychain (status: \(status))"
            }
        }
    }
}
